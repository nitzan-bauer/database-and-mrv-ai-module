import "server-only";
import { audit, type ToolContext } from "./context";

/**
 * The approve/reject half of 0113's pending-agent-actions table. Not a
 * ToolContext-gated "tool" itself (it's invoked directly by a human
 * clicking a button in /agents/approvals, never by an agent's own
 * tool-calling loop) — its job is to build the exact ctx a 'confirm'
 * policy actually passes on (ctx.confirmed === true, per checkPolicy)
 * and replay the original call through the same TOOL_REGISTRY entry
 * runAgentTask itself would have used.
 *
 * ctx.actor stays the agent's own id on replay (not the approving
 * human's) — the action is still, correctly, attributed to the agent
 * that proposed it; resolved_by/resolved_at on the pending row is where
 * "which human approved this" actually lives. This matches
 * context.ts's own forward-looking comment: "a future 'approve and
 * retry' UI wiring ctx.confirmed through."
 */
export interface ResolvePendingActionInput {
  pendingId: string;
  decision: "approve" | "reject";
  approverEmail: string;
  /** The approving human's own live Google token — several 'confirm' tools (sync_pdd_google_doc, schedule_calendar_event, compile_eligibility_evidence_pack) need one to actually execute. */
  googleAccessToken?: string;
}

export interface ResolvedPendingAction {
  ok: boolean;
  detail: string;
}

export async function resolvePendingAgentAction(input: ResolvePendingActionInput): Promise<ResolvedPendingAction> {
  const { query } = await import("../db");

  const rows = await query<{
    pending_id: string;
    agent_id: string;
    action_name: string;
    input: Record<string, unknown>;
    status: string;
  }>(
    `SELECT pending_id, agent_id, action_name, input, status FROM mrv.pending_agent_actions WHERE pending_id = $1`,
    [input.pendingId],
  );
  if (!rows.length) return { ok: false, detail: "No such pending action." };
  const row = rows[0];
  if (row.status !== "pending") return { ok: false, detail: `Already ${row.status} — nothing to do.` };

  const approverEmail = input.approverEmail.trim().toLowerCase();
  const userRows = await query<{ user_id: string }>(`SELECT user_id FROM mrv.users WHERE email = $1`, [approverEmail]);
  if (!userRows.length) {
    return { ok: false, detail: "Your account has no mrv.users row yet — sign out and back in, then try again." };
  }
  const approverUserId = userRows[0].user_id;

  if (input.decision === "reject") {
    await query(
      `UPDATE mrv.pending_agent_actions SET status = 'rejected', resolved_by = $2, resolved_at = clock_timestamp() WHERE pending_id = $1`,
      [row.pending_id, approverUserId],
    );
    await audit(
      { actor: approverEmail, actorKind: "human" },
      "reject_pending_agent_action",
      { type: "pending_agent_action", id: row.pending_id },
      { agentId: row.agent_id, actionName: row.action_name },
    );
    return { ok: true, detail: "Rejected." };
  }

  const { TOOL_REGISTRY } = await import("../agent/toolRegistry");
  const entry = TOOL_REGISTRY[row.action_name];
  if (!entry) {
    return { ok: false, detail: `No handler registered for "${row.action_name}" anymore — cannot replay this.` };
  }

  const ctx: ToolContext = {
    actor: row.agent_id,
    actorKind: "agent",
    confirmed: true,
    userId: approverUserId,
    googleAccessToken: input.googleAccessToken,
  };
  const result = await entry.handler(ctx, row.input);

  await query(
    `UPDATE mrv.pending_agent_actions
        SET status = $2, resolved_by = $3, resolved_at = clock_timestamp(), result = $4::jsonb
      WHERE pending_id = $1`,
    [row.pending_id, result.ok ? "approved" : "failed", approverUserId, JSON.stringify(result)],
  );

  await audit(
    { actor: approverEmail, actorKind: "human" },
    "approve_pending_agent_action",
    { type: "pending_agent_action", id: row.pending_id },
    { agentId: row.agent_id, actionName: row.action_name, succeeded: result.ok },
  );

  return {
    ok: result.ok,
    detail: result.ok ? "Approved and executed." : `Approved, but execution failed: ${result.ok ? "" : result.error}`,
  };
}
