import "server-only";
import { checkCrmPolicy, crmAudit, ok, fail, type ToolContext, type ToolResult } from "./crmContext";

export interface AddCrmFollowUpInput {
  leadId: string;
  description: string;
  dueAt?: string;
}

/** Jennifer and Ron's add_follow_up tool — an open task on a lead (spec §9). Internal action, runs automatically. */
export async function addCrmFollowUp(ctx: ToolContext, input: AddCrmFollowUpInput): Promise<ToolResult<{ followUpId: string }>> {
  const policy = await checkCrmPolicy("add_follow_up", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.description.trim()) return fail("addCrmFollowUp: description is required.");

  const { crmQuery } = await import("../crmDb");
  const rows = await crmQuery<{ follow_up_id: string }>(
    `INSERT INTO crm.follow_ups (lead_id, description, due_at, created_by) VALUES ($1, $2, $3, $4) RETURNING follow_up_id`,
    [input.leadId, input.description, input.dueAt ?? null, ctx.actor],
  );

  await crmAudit(ctx, "add_follow_up", { type: "lead", id: input.leadId }, { description: input.description });

  return ok({ followUpId: rows[0].follow_up_id });
}
