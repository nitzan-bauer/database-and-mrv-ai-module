import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "ron_expiry_reminder";

/** Both Sale Cycle windows (signature, payment) are 7 days; remind at day 4-5, 2-3 days before the daily 06:00 UTC expiry job cancels the deal. */
const WINDOW_DAYS = 7;
const REMINDER_FROM_DAY = 4;
const REMINDER_TO_DAY = 5;

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}
function inReminderWindow(days: number): boolean {
  return days >= REMINDER_FROM_DAY && days <= REMINDER_TO_DAY;
}

/**
 * Ron's expiry reminder (Phase 5/6 of the approved plan) — a pre-emptive
 * nudge before the SaaS's own daily expiry job (06:00 UTC, confirmed live
 * in the Sale Cycle handbooks) auto-cancels an unsigned or unpaid deal at
 * day 7. Covers both financing tracks' both windows (signature, payment).
 * Drafts via draft_outreach_message, same governance as every other
 * customer-facing touchpoint this phase.
 */
export async function runRonExpiryReminder(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { crmQuery } = await import("../../crmDb");
  const { draftOutreachMessage } = await import("../../tools/draftOutreachMessage");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const {
    listAgriInputsReservations,
    listAgriContractsForReservations,
    readReservationPaymentsLedger,
    readProjectFinancingsLedger,
    listSaasProfileEmails,
  } = await import("../../saas/saasClient");

  async function alreadyReminded(dealId: string, key: string): Promise<boolean> {
    const rows = await query(`SELECT 1 FROM mrv.retention_touchpoints WHERE entity_type = 'deal' AND entity_id = $1 AND touchpoint_key = $2`, [dealId, key]);
    return rows.length > 0;
  }
  async function recordReminder(dealId: string, key: string): Promise<void> {
    await query(
      `INSERT INTO mrv.retention_touchpoints (entity_type, entity_id, touchpoint_key) VALUES ('deal', $1, $2)
       ON CONFLICT (entity_type, entity_id, touchpoint_key) DO UPDATE SET last_sent_at = now()`,
      [dealId, key],
    );
  }
  async function leadIdForEmail(email: string | null): Promise<string | null> {
    if (!email) return null;
    const rows = await crmQuery<{ lead_id: string }>(`SELECT lead_id FROM crm.leads WHERE email = $1 LIMIT 1`, [email]);
    return rows[0]?.lead_id ?? null;
  }

  let drafted = 0;
  let skippedNoLead = 0;

  // ---- Agri-Inputs ----------------------------------------------------
  const reservations = await listAgriInputsReservations();
  const contracts = await listAgriContractsForReservations(reservations.map((r) => r.id));
  const contractByReservation = new Map(contracts.map((c) => [c.reservation_id, c]));
  const paidLedger = await readReservationPaymentsLedger();
  const paidByReservation = new Map(paidLedger.map((p) => [p.reservationId, p.paidAt]));
  const buyerEmails = await listSaasProfileEmails(reservations.map((r) => r.buyer_id));

  for (const r of reservations) {
    const contract = contractByReservation.get(r.id);
    const email = buyerEmails.get(r.buyer_id) ?? null;
    const leadId = await leadIdForEmail(email);

    let reminderKey: string | null = null;
    let message: { subject: string; body: string } | null = null;

    if (!contract || contract.status === "draft" || contract.status === "sent") {
      // Not yet signed — the "created" reference point isn't returned by
      // listAgriContractsForReservations, so this branch is intentionally
      // narrow: only fires once contract.signed_at exists is false AND we
      // have no better anchor. In practice contracts are issued within
      // minutes of the reservation, so the reservation's own created_at
      // is a reasonable proxy for "issued".
      const days = daysSince(r.created_at);
      if (inReminderWindow(days)) {
        reminderKey = "sign_reminder";
        message = {
          subject: `Reminder — your CarboNature agreement (${r.transaction_no ?? r.id}) expires soon`,
          body: `Hi,\n\nJust a reminder: your Funding Agri-Inputs agreement (transaction ${r.transaction_no ?? r.id}) needs to be signed within 7 business days of issue, or the reservation is automatically cancelled and the plots released. You're on day ${Math.floor(days)} — please sign in your dashboard when you get a chance.\n\nRon\nCarboNature`,
        };
      }
    } else if ((contract.status === "signed" || contract.status === "countersigned") && contract.signed_at && !paidByReservation.has(r.id)) {
      const days = daysSince(contract.signed_at);
      if (inReminderWindow(days)) {
        reminderKey = "payment_reminder";
        message = {
          subject: `Reminder — payment for ${r.transaction_no ?? r.id} is due soon`,
          body: `Hi,\n\nA reminder that payment for transaction ${r.transaction_no ?? r.id} is due within 7 days of signature, or the deal is automatically cancelled and the plots released. You're on day ${Math.floor(days)} since signing — let us know if you need the proforma invoice resent.\n\nRon\nCarboNature`,
        };
      }
    }

    if (!reminderKey || !message) continue;
    if (await alreadyReminded(r.id, reminderKey)) continue;
    if (!leadId) {
      skippedNoLead++;
      continue;
    }
    const result = await draftOutreachMessage(ctx, { leadId, channel: "email", subject: message.subject, body: message.body });
    if (result.ok) drafted++;
    await recordReminder(r.id, reminderKey);
  }

  // ---- Project Funding --------------------------------------------------
  const financings = await readProjectFinancingsLedger();
  const pfEmails = await listSaasProfileEmails(financings.map((f) => f.buyerId));

  for (const f of financings) {
    const email = pfEmails.get(f.buyerId) ?? null;
    const leadId = await leadIdForEmail(email);

    let reminderKey: string | null = null;
    let message: { subject: string; body: string } | null = null;

    if (f.status === "awaiting_signature") {
      const days = daysSince(f.createdAt);
      if (inReminderWindow(days)) {
        reminderKey = "sign_reminder";
        message = {
          subject: `Reminder — your CarboNature Project Funding agreement (${f.transactionNo}) expires soon`,
          body: `Hi,\n\nA reminder: your Project Funding agreement (transaction ${f.transactionNo}) needs to be signed within 7 days of issue, or the deal is automatically cancelled. You're on day ${Math.floor(days)} — please sign in your dashboard when you get a chance.\n\nRon\nCarboNature`,
        };
      }
    } else if (f.status === "pending_payment" && f.signedAt) {
      const days = daysSince(f.signedAt);
      if (inReminderWindow(days)) {
        reminderKey = "payment_reminder";
        message = {
          subject: `Reminder — payment for ${f.transactionNo} is due soon`,
          body: `Hi,\n\nA reminder that payment for transaction ${f.transactionNo} is due within 7 days of signature, or the deal is automatically cancelled and the credits released. You're on day ${Math.floor(days)} since signing — let us know if you need the proforma invoice resent.\n\nRon\nCarboNature`,
        };
      }
    }

    if (!reminderKey || !message) continue;
    if (await alreadyReminded(f.id, reminderKey)) continue;
    if (!leadId) {
      skippedNoLead++;
      continue;
    }
    const result = await draftOutreachMessage(ctx, { leadId, channel: "email", subject: message.subject, body: message.body });
    if (result.ok) drafted++;
    await recordReminder(f.id, reminderKey);
  }

  const paragraphs = [
    `Drafted ${drafted} expiry reminder(s) (day ${REMINDER_FROM_DAY}-${REMINDER_TO_DAY} of the 7-day signature/payment window), pending human approval in the CRM's own queue.`,
  ];
  if (skippedNoLead) paragraphs.push(`${skippedNoLead} deal(s) due for a reminder had no matching CRM lead by email — skipped.`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Expiry reminders — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "expiry_reminder",
    sendEmail: drafted > 0 || skippedNoLead > 0,
    agentId: "ron",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (drafted: ${drafted}.)` };
}
