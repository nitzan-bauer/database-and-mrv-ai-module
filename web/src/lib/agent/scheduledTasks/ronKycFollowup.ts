import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "ron_kyc_followup";

/** First reminder after this many days without documents; re-reminded at the same interval thereafter. */
const REMINDER_INTERVAL_DAYS = 5;

/**
 * Ron's weekly KYC follow-up (approved plan, Phase 3). Reads mrv.kyc_tracking
 * (populated by the account-opening webhook) for credit buyers stuck short
 * of 'cleared' for more than REMINDER_INTERVAL_DAYS since their last
 * reminder (or since KYC was requested, for a first reminder).
 *
 * Drafts a reminder via draft_outreach_message rather than sending it
 * directly — matching this codebase's own existing governance for CRM
 * tools ("anything leaving the building -> Draft; anything internal ->
 * automatic", draftOutreachMessage.ts's own words) rather than inventing a
 * new fully-automatic external-send path. A human approves the send from
 * the CRM app's own queue. This task never writes 'cleared' itself — that
 * stays a human-only transition, per the plan's own risk mitigation.
 */
export async function runRonKycFollowup(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { crmQuery } = await import("../../crmDb");
  const { draftOutreachMessage } = await import("../../tools/draftOutreachMessage");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const due = await query<{
    buyer_id: string;
    buyer_company_name: string;
    buyer_email: string | null;
    status: string;
    requested_at: string;
    last_reminder_sent_at: string | null;
  }>(
    `SELECT buyer_id, buyer_company_name, buyer_email, status, requested_at, last_reminder_sent_at
       FROM mrv.kyc_tracking
      WHERE status NOT IN ('cleared', 'rejected')
        AND COALESCE(last_reminder_sent_at, requested_at) <= now() - ($1::text || ' days')::interval`,
    [REMINDER_INTERVAL_DAYS],
  );

  let drafted = 0;
  const skippedNoEmail: string[] = [];
  const skippedNoLead: string[] = [];

  for (const buyer of due) {
    if (!buyer.buyer_email) {
      skippedNoEmail.push(buyer.buyer_company_name);
      continue;
    }
    const leads = await crmQuery<{ lead_id: string }>(`SELECT lead_id FROM crm.leads WHERE email = $1 LIMIT 1`, [buyer.buyer_email]);
    if (!leads.length) {
      skippedNoLead.push(buyer.buyer_company_name);
      continue;
    }

    const body = `Hi,

We're still waiting on a few documents to complete your KYC/AML review before your first transaction on the CarboNature platform can proceed:

- Certificate of incorporation, or a current extract from the official company registry
- A photo identity document of the person signing the transaction
- A completed W-8BEN-E (or equivalent certificate of tax residence)

Please email these to info@carbonature.io at your earliest convenience so we can complete the review (typically 1-3 business days once received).

Thank you,
Ron
CarboNature`;

    const draft = await draftOutreachMessage(ctx, {
      leadId: leads[0].lead_id,
      channel: "email",
      subject: "CarboNature — completing your KYC review",
      body,
    });
    if (!draft.ok) continue;

    await query(`UPDATE mrv.kyc_tracking SET last_reminder_sent_at = now(), updated_at = now() WHERE buyer_id = $1`, [buyer.buyer_id]);
    drafted++;
  }

  const paragraphs = [
    `Drafted ${drafted} KYC follow-up reminder(s), pending human approval in the CRM's own queue (this task never sends externally, and never sets 'cleared').`,
  ];
  if (skippedNoEmail.length) paragraphs.push(`${skippedNoEmail.length} buyer(s) skipped — no email on file: ${skippedNoEmail.join(", ")}.`);
  if (skippedNoLead.length) paragraphs.push(`${skippedNoLead.length} buyer(s) skipped — no matching CRM lead found: ${skippedNoLead.join(", ")}.`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `KYC follow-up — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "kyc_followup",
    sendEmail: drafted > 0 || skippedNoEmail.length > 0 || skippedNoLead.length > 0,
    agentId: "ron",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (drafted: ${drafted}.)` };
}
