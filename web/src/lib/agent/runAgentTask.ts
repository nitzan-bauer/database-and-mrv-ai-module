import "server-only";
import { getAgent } from "../data";
import { DATA_MODE } from "../env";
import { audit, type ToolContext } from "../tools/context";
import { getConfiguredProvider, type ModelProvider } from "./provider";
import { TOOL_REGISTRY } from "./toolRegistry";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A task comes from a person, who names a farm the way they would in
 * conversation — "Elad Farm" — never by its UUID. Every tool that takes a
 * farmId is written against the real primary key, so a name typed straight
 * through reaches Postgres as a malformed uuid literal rather than a
 * sensible "not found". Resolving it here, once, keeps every farmId tool
 * working the way a person actually asks for one instead of teaching each
 * tool to guess what it was handed.
 */
type FarmIdResolution = { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

async function resolveFarmId(input: Record<string, unknown>): Promise<FarmIdResolution> {
  const farmId = input.farmId;
  if (typeof farmId !== "string" || UUID_RE.test(farmId) || DATA_MODE !== "db") return { ok: true, input };

  const { query } = await import("../db");
  const matches = await query<{ farm_id: string }>(`SELECT farm_id FROM mrv.farms WHERE lower(name) = lower($1)`, [
    farmId,
  ]);
  if (matches.length === 1) return { ok: true, input: { ...input, farmId: matches[0].farm_id } };
  if (matches.length === 0) {
    return { ok: false, error: `No farm named "${farmId}" — check the spelling or pass its id directly.` };
  }
  return { ok: false, error: `More than one farm is named "${farmId}" — ask by id instead.` };
}

export type AgentTaskOutcome =
  | { kind: "text"; text: string }
  | { kind: "executed"; action: string; result: unknown; warnings?: string[] }
  | { kind: "needs_confirmation"; action: string; input: Record<string, unknown>; reason: string }
  | { kind: "error"; message: string };

export interface AgentTaskResult {
  agentId: string;
  providerId: string;
  outcome: AgentTaskOutcome;
}

/**
 * One turn: an agent, a task, one model call, at most one tool call.
 *
 * This is deliberately not a multi-step agentic loop that keeps calling
 * tools until it decides it is done. A single step is the largest unit
 * that stays fully auditable from outside the model — one request, one
 * response, one action taken or withheld — and every write this project
 * has built already goes through checkPolicy and audit() on its own, so
 * the loop does not need to reimplement either. Multi-step planning can
 * be layered on top of this once there is a reason to need it; there
 * isn't yet.
 *
 * Two audit entries result from a successful call, at two different
 * layers on purpose. This function logs `invoke_agent` under the
 * *caller's* identity — who asked the agent to do something — before the
 * model is even called. The tool itself then logs its own action under
 * the *agent's* identity, exactly as if a person had called it directly.
 * Losing either half would lose half of the accountability: without the
 * first, nothing connects a person to the agent turn that followed;
 * without the second, an agent's action would be indistinguishable from
 * a person's in mrv.audit_log, which defeats the reason actor_id is
 * prefixed 'agent:' at all.
 */
export async function runAgentTask(
  agentId: string,
  userTask: string,
  opts: { requestedBy: string; confirmed?: boolean; provider?: ModelProvider; googleAccessToken?: string },
): Promise<AgentTaskResult> {
  const agent = await getAgent(agentId);
  if (!agent) {
    return { agentId, providerId: "-", outcome: { kind: "error", message: `No such agent: ${agentId}` } };
  }

  await audit(
    { actor: opts.requestedBy, actorKind: "human" },
    "invoke_agent",
    { type: "agent", id: agentId },
    { task: userTask },
  );

  const provider = opts.provider ?? (await getConfiguredProvider());

  // Only the schemas for tools this agent actually holds — never its
  // planned_tools, and never the registry's full set. An agent cannot be
  // offered more than it is allowed to do just because a handler exists
  // for someone else.
  const schemas = agent.tools
    .map((name) => TOOL_REGISTRY[name]?.schema)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  let response;
  try {
    response = await provider.complete({ system: agent.rolePrompt, userMessage: userTask, tools: schemas });
  } catch (e) {
    return {
      agentId,
      providerId: provider.id,
      outcome: { kind: "error", message: e instanceof Error ? e.message : String(e) },
    };
  }

  if (response.kind === "text") {
    return { agentId, providerId: provider.id, outcome: { kind: "text", text: response.text } };
  }

  const entry = TOOL_REGISTRY[response.call.name];
  // Defence in depth: the schemas offered were already restricted to
  // agent.tools, but a provider's claim about what it called is not
  // trusted just because it matches — checked again here against the
  // same list, not against the registry's full set.
  if (!entry || !agent.tools.includes(response.call.name)) {
    return {
      agentId,
      providerId: provider.id,
      outcome: {
        kind: "error",
        message: `${agent.displayName} tried to call "${response.call.name}", which is not one of the tools it holds.`,
      },
    };
  }

  const resolved = await resolveFarmId(response.call.input);
  if (!resolved.ok) {
    return { agentId, providerId: provider.id, outcome: { kind: "error", message: resolved.error } };
  }

  // The agent acts with exactly the Google access the human who invoked it
  // already has by hand — not a separate service identity. Without this,
  // any Drive/Gmail/Calendar tool an agent holds fails with "no token for
  // this session" even when the requester's own sign-in granted the scope.
  const ctx: ToolContext = {
    actor: agent.actorId,
    actorKind: "agent",
    confirmed: opts.confirmed,
    googleAccessToken: opts.googleAccessToken,
  };
  const result = await entry.handler(ctx, resolved.input);

  if (!result.ok) {
    if (result.needsConfirmation) {
      return {
        agentId,
        providerId: provider.id,
        outcome: {
          kind: "needs_confirmation",
          action: response.call.name,
          input: response.call.input,
          reason: result.error,
        },
      };
    }
    return { agentId, providerId: provider.id, outcome: { kind: "error", message: result.error } };
  }

  return {
    agentId,
    providerId: provider.id,
    outcome: {
      kind: "executed",
      action: response.call.name,
      result: result.data,
      warnings: result.warnings,
    },
  };
}
