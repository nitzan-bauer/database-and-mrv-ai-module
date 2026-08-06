import "server-only";
import { checkCrmPolicy, crmAudit, ok, fail, type ToolContext, type ToolResult } from "./crmContext";

export interface DraftOutreachMessageInput {
  leadId: string;
  channel: string; // 'email' | 'linkedin' | ...
  body: string;
}

export interface DraftOutreachMessageResult {
  draftId: string;
  status: "pending_approval";
}

/**
 * Jennifer and Ron's draft_outreach_message tool — the human-in-the-loop
 * checkpoint from spec §4: "anything leaving the building → Draft; anything
 * internal → automatic." Drafting is itself an internal action (nothing
 * external happens yet, so it runs automatically), but the row it creates
 * always starts at pending_approval and nothing in this codebase ever
 * flips it to 'approved' except a human, in the CRM app's own approval
 * queue — no tool in this registry can approve its own draft.
 */
export async function draftOutreachMessage(
  ctx: ToolContext,
  input: DraftOutreachMessageInput,
): Promise<ToolResult<DraftOutreachMessageResult>> {
  const policy = await checkCrmPolicy("draft_outreach_message", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.body.trim()) return fail("draftOutreachMessage: body is required.");
  if (!input.channel.trim()) return fail("draftOutreachMessage: channel is required.");

  const { crmQuery } = await import("../crmDb");
  const rows = await crmQuery<{ draft_id: string }>(
    `INSERT INTO crm.draft_messages (lead_id, channel, body, created_by_agent)
     VALUES ($1, $2, $3, $4) RETURNING draft_id`,
    [input.leadId, input.channel, input.body, ctx.actor],
  );

  await crmAudit(ctx, "draft_outreach_message", { type: "lead", id: input.leadId }, { channel: input.channel });

  return ok({ draftId: rows[0].draft_id, status: "pending_approval" });
}
