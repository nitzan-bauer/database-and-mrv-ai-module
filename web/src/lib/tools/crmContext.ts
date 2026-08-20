import "server-only";
import { fail, ok, type ToolContext, type ToolResult } from "./context";

/**
 * The crm-schema counterpart to context.ts's checkPolicy/audit — deliberately
 * separate rather than folded into ActionName/checkPolicy, because these
 * actions are governed by crm.agent_action_policies (a table this module
 * does not own; it belongs to the carbonature-crm repo's own migrations) and
 * logged to crm.audit_log, not mrv's. Keeping the two apart means neither
 * schema's policy table has to know the other exists.
 */
export type CrmActionName =
  | "record_lead"
  | "update_lead_stage"
  | "add_follow_up"
  | "draft_outreach_message"
  | "crm_hygiene"
  | "farmer_funnel"
  | "buyer_funnel";

export async function checkCrmPolicy(
  action: CrmActionName,
  ctx: ToolContext,
): Promise<{ allowed: boolean; reason?: string }> {
  if (ctx.actorKind === "human") return { allowed: true };

  const { crmQuery } = await import("../crmDb");
  const rows = await crmQuery<{ mode: string; note: string | null }>(
    `SELECT mode, note FROM crm.agent_action_policies WHERE action_name = $1`,
    [action],
  );

  if (!rows.length) {
    return {
      allowed: false,
      reason: `No policy is recorded for "${action}", so it cannot run unattended. Add one in the CRM's agent_action_policies.`,
    };
  }

  const { mode, note } = rows[0];
  if (mode === "auto" || ctx.confirmed) return { allowed: true };

  return {
    allowed: false,
    reason: `"${action}" is set to ${mode} — it needs a manager to approve this call.` + (note ? ` ${note}` : ""),
  };
}

export async function crmAudit(
  ctx: ToolContext,
  action: string,
  target: { type: string; id: string } | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const { crmQuery } = await import("../crmDb");
  await crmQuery(
    `INSERT INTO crm.audit_log (actor, action, target_type, target_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [ctx.actor, action, target?.type ?? null, target?.id ?? null, JSON.stringify({ ...payload, actorKind: ctx.actorKind })],
  );
}

export { ok, fail };
export type { ToolContext, ToolResult };
