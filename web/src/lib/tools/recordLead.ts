import "server-only";
import { checkCrmPolicy, crmAudit, ok, fail, type ToolContext, type ToolResult } from "./crmContext";

export type CrmLeadType = "farmer" | "credit_buyer";

export interface RecordLeadInput {
  leadType: CrmLeadType;
  fullName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  farmId?: string;
  leadSource?: string;
}

export interface RecordLeadResult {
  leadId: string;
  currentStage: string;
}

/**
 * Jennifer and Ron's record_lead tool (spec §3, §9) — an internal action,
 * so it runs automatically once the policy row allows it: no draft/approval
 * step, unlike draft_outreach_message. Writes straight into crm.leads on
 * the shared RDS instance, the same tables the CRM web app's own UI uses.
 */
export async function recordLead(ctx: ToolContext, input: RecordLeadInput): Promise<ToolResult<RecordLeadResult>> {
  const policy = await checkCrmPolicy("record_lead", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.fullName.trim()) return fail("recordLead: fullName is required.");

  const { crmQuery } = await import("../crmDb");

  const stages = await crmQuery<{ name: string }>(
    `SELECT name FROM crm.pipeline_stages WHERE lead_type = $1 ORDER BY sort_order LIMIT 1`,
    [input.leadType],
  );
  const firstStage = stages[0]?.name ?? "Open account";

  const rows = await crmQuery<{ lead_id: string }>(
    `INSERT INTO crm.leads (lead_type, full_name, email, phone, company_name, farm_id, lead_source, current_stage, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING lead_id`,
    [
      input.leadType,
      input.fullName,
      input.email ?? null,
      input.phone ?? null,
      input.companyName ?? null,
      input.farmId ?? null,
      input.leadSource ?? "manual",
      firstStage,
      ctx.actor,
    ],
  );
  const leadId = rows[0].lead_id;

  await crmQuery(`INSERT INTO crm.stage_history (lead_id, from_stage, to_stage, changed_by) VALUES ($1, NULL, $2, $3)`, [
    leadId,
    firstStage,
    ctx.actor,
  ]);

  await crmAudit(ctx, "record_lead", { type: "lead", id: leadId }, { leadType: input.leadType, leadSource: input.leadSource });

  return ok({ leadId, currentStage: firstStage });
}
