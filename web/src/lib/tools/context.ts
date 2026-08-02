import "server-only";
import { DATA_MODE } from "../env";

/**
 * The write surface of the MRV module.
 *
 * Every change to project data goes through a tool in this directory, and
 * nothing here is shaped for a form. That is deliberate: the six actions in
 * mrv.agent_action_policies — propose_sampling_plan, send_work_order,
 * run_model, recalibrate_model, issue_alerts, chat — are the same actions a
 * manager performs by hand. Building them as tools means the Tier-2 agents
 * call exactly what a person clicks, rather than a second implementation
 * that has to be kept in step with the first.
 *
 * Three things follow from that, and they are the reason this file exists
 * rather than each tool doing its own thing:
 *
 *   - the actor is always named. A row in mrv.audit_log that says only
 *     "the system did it" is worth nothing to a VVB asking why a figure
 *     moved, so a tool cannot run without an identity.
 *   - the auto/confirm policy is enforced in one place. If each tool
 *     checked its own, an agent action that should require a manager's
 *     click would eventually slip through on a tool that forgot.
 *   - failures are values, not exceptions. These run behind server actions
 *     and, later, behind an agent loop; a thrown error there becomes an
 *     opaque 500 or a retry storm.
 */

export type ActorKind = "human" | "agent";

export interface ToolContext {
  /** Email for a person, agent id for an agent. Recorded on every write. */
  actor: string;
  actorKind: ActorKind;
  /** mrv.users.user_id once known. Some writes require it by constraint. */
  userId?: string;
  /**
   * A manager has approved this specific call. Only meaningful for actions
   * whose policy is 'confirm': it is the click, not a way around the rule.
   */
  confirmed?: boolean;
}

export type ToolResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: string; needsConfirmation?: boolean };

export const ok = <T>(data: T, warnings?: string[]): ToolResult<T> =>
  warnings?.length ? { ok: true, data, warnings } : { ok: true, data };

export const fail = <T>(error: string, needsConfirmation = false): ToolResult<T> =>
  needsConfirmation ? { ok: false, error, needsConfirmation } : { ok: false, error };

/** The action names in mrv.agent_action_policies. */
export type ActionName =
  | "propose_sampling_plan"
  | "send_work_order"
  | "run_model"
  | "recalibrate_model"
  | "issue_alerts"
  | "chat"
  | "register_pdd_template"
  | "run_plot_qa_qc"
  | "export_plots_kml"
  | "record_baseline_site"
  | "record_activity_data";

/**
 * Check the policy for an action and record the attempt.
 *
 * The policy is read from the database rather than hard-coded, because it is
 * editable in Admin — a hard-coded copy would drift the moment someone
 * changed it there, and the drift would only show up as an agent doing
 * something it should have asked about first.
 *
 * A human acting directly is not subject to it: 'confirm' means "an agent
 * must get a person to approve this", and a person doing it themselves is
 * that approval.
 */
export async function checkPolicy(
  action: ActionName,
  ctx: ToolContext,
): Promise<{ allowed: boolean; reason?: string }> {
  if (ctx.actorKind === "human") return { allowed: true };
  if (DATA_MODE === "fixtures") return { allowed: true };

  const { query } = await import("../db");
  const rows = await query<{ mode: string; note: string | null }>(
    `SELECT mode::text, note FROM mrv.agent_action_policies WHERE action_name = $1`,
    [action],
  );

  // An action with no policy row is refused rather than allowed. A missing
  // policy is far more likely to be an action nobody has reviewed than one
  // that was decided to be unrestricted.
  if (!rows.length) {
    return {
      allowed: false,
      reason: `No policy is recorded for "${action}", so it cannot run unattended. Add one in Admin.`,
    };
  }

  const { mode, note } = rows[0];
  if (mode === "auto" || ctx.confirmed) return { allowed: true };

  return {
    allowed: false,
    reason:
      `"${action}" is set to ${mode} — it needs a manager to approve this call.` +
      (note ? ` ${note}` : ""),
  };
}

/**
 * Write one row to mrv.audit_log.
 *
 * Separate from the table's own triggers on purpose. Those capture the
 * before/after of a row; this captures the intent — which tool ran, who
 * asked, and with what arguments — which is what makes a change explicable
 * months later rather than merely visible.
 */
export async function audit(
  ctx: ToolContext,
  action: string,
  target: { type: string; id: string } | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (DATA_MODE === "fixtures") return;
  const { query } = await import("../db");
  await query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      ctx.actor,
      action,
      target?.type ?? null,
      target?.id ?? null,
      JSON.stringify({ ...payload, actorKind: ctx.actorKind }),
    ],
  );
}

/** Tools write; fixtures are a fixed demo set with nothing to write to. */
export function requireDbMode(tool: string): ToolResult<never> | null {
  return DATA_MODE === "fixtures"
    ? fail(`${tool} needs the database — the module is running on fixtures, which are read-only.`)
    : null;
}
