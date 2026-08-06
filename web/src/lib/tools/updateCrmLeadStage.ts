import "server-only";
import { checkCrmPolicy, crmAudit, ok, fail, type ToolContext, type ToolResult } from "./crmContext";

export interface UpdateCrmLeadStageInput {
  leadId: string;
  toStage: string;
}

/**
 * Jennifer and Ron's update_lead_stage tool — moves a lead through its
 * pipeline (spec §6) and records the change in crm.stage_history. An
 * internal action: no approval needed, same as the CRM web app's own
 * stage-update path.
 */
export async function updateCrmLeadStage(ctx: ToolContext, input: UpdateCrmLeadStageInput): Promise<ToolResult<null>> {
  const policy = await checkCrmPolicy("update_lead_stage", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.toStage.trim()) return fail("updateCrmLeadStage: toStage is required.");

  const { crmTransaction } = await import("../crmDb");
  let fromStage: string;
  try {
    fromStage = await crmTransaction(async (tx) => {
      const current = await tx.query<{ current_stage: string }>(
        `SELECT current_stage FROM crm.leads WHERE lead_id = $1 FOR UPDATE`,
        [input.leadId],
      );
      if (!current.rows.length) throw new Error("No such lead.");
      const from = current.rows[0].current_stage;
      await tx.query(`UPDATE crm.leads SET current_stage = $1 WHERE lead_id = $2`, [input.toStage, input.leadId]);
      await tx.query(
        `INSERT INTO crm.stage_history (lead_id, from_stage, to_stage, changed_by) VALUES ($1, $2, $3, $4)`,
        [input.leadId, from, input.toStage, ctx.actor],
      );
      return from;
    });
  } catch (e) {
    return fail(`updateCrmLeadStage: ${e instanceof Error ? e.message : String(e)}`);
  }

  await crmAudit(ctx, "update_lead_stage", { type: "lead", id: input.leadId }, { fromStage, toStage: input.toStage });

  return ok(null);
}
