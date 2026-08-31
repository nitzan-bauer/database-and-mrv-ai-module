import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "ron_crop_cycle_reminder";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Escalating tiers, largest (earliest) first — the smallest not-yet-sent tier that's due fires, one per run, per Nitzan's own spec (2026-08-26). */
const TIERS = [45, 30, 15, 7];
const ORCHARD_CHECKIN_INTERVAL_DAYS = 350;
const OVERDUE_RESEND_INTERVAL_DAYS = 14;

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / DAY_MS;
}
function daysSince(iso: string): number {
  return daysBetween(new Date(), new Date(iso));
}

/**
 * The crop-cycle reminder Nitzan asked for (2026-08-26): open-field crops
 * get an escalating series (45/30/15/7 days before season end, sent one
 * tier at a time as each is crossed — not all at once), orchards get an
 * annual check-in ("plans can change over 25 years"). Plot type comes
 * from mrv.project_plot_type_defaults; cycle length per crop comes from
 * mrv.crop_cycle_lengths, which Nitzan fills in by hand via /admin — a
 * crop not yet in that table is reported as skipped, never guessed.
 * Drafts via draft_outreach_message, same governance as every other
 * customer-facing touchpoint.
 */
export async function runRonCropCycleReminder(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { crmQuery } = await import("../../crmDb");
  const { draftOutreachMessage } = await import("../../tools/draftOutreachMessage");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const { listFarmProfileIds, listSaasProfileEmails, listFarmNamesByIds } = await import("../../saas/saasClient");

  const plots = await query<{
    plot_id: string;
    farm_id: string;
    plot_type: string | null;
    crop: string | null;
    planting_date: string | null;
  }>(`SELECT plot_id, farm_id, plot_type, crop, planting_date FROM mrv.plot_crop_cycles WHERE crop IS NOT NULL AND planting_date IS NOT NULL`);

  const farmIds = [...new Set(plots.map((p) => p.farm_id))];
  const [farmNames, farmProfileIds] = await Promise.all([listFarmNamesByIds(farmIds), listFarmProfileIds(farmIds)]);
  const farmEmails = await listSaasProfileEmails([...farmProfileIds.values()]);

  const cycleLengths = await query<{ crop_name: string; cycle_days: number }>(`SELECT crop_name, cycle_days FROM mrv.crop_cycle_lengths`);
  const cycleDaysByCrop = new Map(cycleLengths.map((c) => [c.crop_name, c.cycle_days]));

  async function touchpointRow(plotId: string, key: string) {
    const rows = await query<{ last_sent_at: string; last_seen_value: string | null }>(
      `SELECT last_sent_at, last_seen_value FROM mrv.retention_touchpoints WHERE entity_type = 'plot' AND entity_id = $1 AND touchpoint_key = $2`,
      [plotId, key],
    );
    return rows[0] ?? null;
  }
  async function recordTouchpoint(plotId: string, key: string, seenValue: string | null) {
    await query(
      `INSERT INTO mrv.retention_touchpoints (entity_type, entity_id, touchpoint_key, last_sent_at, last_seen_value)
       VALUES ('plot', $1, $2, now(), $3)
       ON CONFLICT (entity_type, entity_id, touchpoint_key) DO UPDATE SET last_sent_at = now(), last_seen_value = $3`,
      [plotId, key, seenValue],
    );
  }
  async function leadIdForEmail(email: string | null): Promise<string | null> {
    if (!email) return null;
    const rows = await crmQuery<{ lead_id: string }>(`SELECT lead_id FROM crm.leads WHERE email = $1 LIMIT 1`, [email]);
    return rows[0]?.lead_id ?? null;
  }

  let drafted = 0;
  let skippedUnknownCrop: string[] = [];
  let skippedNoLead = 0;

  for (const plot of plots) {
    const email = farmEmails.get(farmProfileIds.get(plot.farm_id) ?? "") ?? null;
    const leadId = await leadIdForEmail(email);
    const farmName = farmNames.get(plot.farm_id) ?? plot.farm_id;

    if (plot.plot_type === "young_orchard" || plot.plot_type === "mature_orchard") {
      const prior = await touchpointRow(plot.plot_id, "orchard_annual_checkin");
      if (!prior || daysSince(prior.last_sent_at) >= ORCHARD_CHECKIN_INTERVAL_DAYS) {
        if (!leadId) { skippedNoLead++; continue; }
        const ok = await draftOutreachMessage(ctx, {
          leadId,
          channel: "email",
          subject: `${farmName} — annual check-in on ${plot.crop}`,
          body: `Hi,\n\nA yearly check-in on your ${plot.crop} plot: plans on a long-term orchard can change over the years — new inputs, a change in practice, or anything else worth updating. If anything's changed, please update the plot's info on your dashboard map, or let us know.\n\nRon\nCarboNature`,
        });
        if (ok.ok) drafted++;
        await recordTouchpoint(plot.plot_id, "orchard_annual_checkin", null);
      }
      continue;
    }

    // Open-field (or unclassified — treated as open-field, the more common/urgent case).
    const cropKey = (plot.crop ?? "").trim().toLowerCase();
    const cycleDays = cycleDaysByCrop.get(cropKey);
    if (cycleDays === undefined) {
      if (!skippedUnknownCrop.includes(plot.crop!)) skippedUnknownCrop.push(plot.crop!);
      continue;
    }

    const plantingDate = new Date(plot.planting_date!);
    const seasonEnd = new Date(plantingDate.getTime() + cycleDays * DAY_MS);
    const daysUntilEnd = Math.round(daysBetween(seasonEnd, new Date()));

    let tierKey: string | null = null;
    let urgency = "";
    if (daysUntilEnd < 0) {
      tierKey = "cycle_overdue";
    } else {
      for (const tier of [...TIERS].reverse()) {
        // smallest (most urgent) tier first, so exactly one — the most urgent due-and-unsent — fires per run
        if (daysUntilEnd <= tier) { tierKey = `cycle_reminder_${tier}d`; urgency = tier <= 7 ? " — please update soon" : ""; break; }
      }
    }
    if (!tierKey) continue; // more than 45 days out — nothing due yet

    const prior = await touchpointRow(plot.plot_id, tierKey);
    const alreadySentThisCycle = prior && prior.last_seen_value === plot.planting_date;
    const overdueResendDue = tierKey === "cycle_overdue" && prior && daysSince(prior.last_sent_at) >= OVERDUE_RESEND_INTERVAL_DAYS;
    if (alreadySentThisCycle && !overdueResendDue) continue;

    if (!leadId) { skippedNoLead++; continue; }
    const subject =
      tierKey === "cycle_overdue"
        ? `${farmName} — ${plot.crop} cycle is overdue for an update`
        : `${farmName} — ${plot.crop}'s season is ending soon${urgency}`;
    const body =
      tierKey === "cycle_overdue"
        ? `Hi,\n\nYour ${plot.crop} plot's expected season end has passed based on its recorded planting date. Please update the plot on your dashboard map with the new cycle's crop, inputs, and planting/sowing date whenever you get a chance.\n\nRon\nCarboNature`
        : `Hi,\n\nYour ${plot.crop} plot's season is expected to end in about ${daysUntilEnd} day(s). When it does, please record the new cycle on your dashboard map — the crop, the Agri-Inputs used, and the new planting/sowing date.\n\nRon\nCarboNature`;

    const result = await draftOutreachMessage(ctx, { leadId, channel: "email", subject, body });
    if (result.ok) drafted++;
    await recordTouchpoint(plot.plot_id, tierKey, plot.planting_date);
  }

  const paragraphs = [
    `Drafted ${drafted} crop-cycle reminder(s), pending human approval in the CRM's own queue.`,
  ];
  if (skippedUnknownCrop.length) paragraphs.push(`${skippedUnknownCrop.length} crop(s) have no cycle length defined in mrv.crop_cycle_lengths — add them via /admin: ${skippedUnknownCrop.join(", ")}.`);
  if (skippedNoLead) paragraphs.push(`${skippedNoLead} reminder(s) due had no matching CRM lead by email — skipped.`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Crop-cycle reminders — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "crop_cycle_reminder",
    sendEmail: drafted > 0 || skippedUnknownCrop.length > 0 || skippedNoLead > 0,
    agentId: "ron",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (drafted: ${drafted}.)` };
}
