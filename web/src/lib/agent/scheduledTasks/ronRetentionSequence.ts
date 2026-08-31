import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "ron_retention_sequence";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ron's retention sequences (approved plan, Phase 4) — farmer and
 * credit-buyer touchpoints, each gated through mrv.retention_touchpoints
 * so a touchpoint fires once-ever, on-interval, or on-change as
 * appropriate, never every single weekly run. Every customer-facing send
 * goes through draft_outreach_message (pending_approval) — this task
 * never sends externally itself, matching this codebase's own existing
 * rule (draftOutreachMessage.ts: "anything leaving the building -> Draft;
 * anything internal -> automatic").
 *
 * Two touchpoints from the original plan are DELIBERATELY NOT implemented
 * here, and are reported as skipped every run rather than faked:
 *   - 30-day dashboard-inactivity nudge (farmer AND buyer) — there is no
 *     last-login/last-dashboard-visit timestamp tracked anywhere in
 *     carbonature-saas today (confirmed by search, not assumed).
 *   - Seasonal pre-planting reminder (farmer) — no per-farm/per-project
 *     planting-season calendar exists to compute "before season" against.
 * Building either would mean inventing a data source, not implementing
 * the plan — both need real input before they can exist.
 */
export async function runRonRetentionSequence(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { crmQuery } = await import("../../crmDb");
  const { draftOutreachMessage } = await import("../../tools/draftOutreachMessage");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const {
    listFarmNamesByIds,
    listFarmProfileIds,
    listSaasProfileEmails,
    listAllSaasPlots,
    fetchSaasFarm,
    listActivityStatusByFarmIds,
    listActivityStatusByReservationIds,
  } = await import("../../saas/saasClient");

  async function touchpointRow(entityType: "farm" | "buyer", entityId: string, key: string) {
    const rows = await query<{ last_sent_at: string; last_seen_value: string | null }>(
      `SELECT last_sent_at, last_seen_value FROM mrv.retention_touchpoints WHERE entity_type = $1 AND entity_id = $2 AND touchpoint_key = $3`,
      [entityType, entityId, key],
    );
    return rows[0] ?? null;
  }
  async function recordTouchpoint(entityType: "farm" | "buyer", entityId: string, key: string, seenValue: string | null = null) {
    await query(
      `INSERT INTO mrv.retention_touchpoints (entity_type, entity_id, touchpoint_key, last_sent_at, last_seen_value)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (entity_type, entity_id, touchpoint_key) DO UPDATE SET last_sent_at = now(), last_seen_value = $4`,
      [entityType, entityId, key, seenValue],
    );
  }
  function daysSince(iso: string): number {
    return (Date.now() - new Date(iso).getTime()) / DAY_MS;
  }

  async function leadIdForEmail(email: string | null): Promise<string | null> {
    if (!email) return null;
    const rows = await crmQuery<{ lead_id: string }>(`SELECT lead_id FROM crm.leads WHERE email = $1 LIMIT 1`, [email]);
    return rows[0]?.lead_id ?? null;
  }

  async function draft(leadId: string, subject: string, body: string): Promise<boolean> {
    const result = await draftOutreachMessage(ctx, { leadId, channel: "email", subject, body });
    return result.ok;
  }

  let drafted = 0;
  const skippedNoLead: string[] = [];

  // ---- Farmers -----------------------------------------------------
  const farmRows = await query<{ farm_id: string }>(
    `SELECT DISTINCT farm_id FROM mrv.allocation_register WHERE farm_id IS NOT NULL AND status <> 'released'`,
  );
  const farmIds = farmRows.map((r) => r.farm_id);
  const [farmNames, farmProfileIds, allPlots] = await Promise.all([
    listFarmNamesByIds(farmIds),
    listFarmProfileIds(farmIds),
    listAllSaasPlots(),
  ]);
  const farmEmails = await listSaasProfileEmails([...farmProfileIds.values()]);
  const activityByFarm = await listActivityStatusByFarmIds(farmIds);
  const latestActivityByFarm = new Map<string, string>();
  for (const a of activityByFarm) {
    if (a.farm_id && !latestActivityByFarm.has(a.farm_id)) latestActivityByFarm.set(a.farm_id, a.current_status);
  }

  for (const farmId of farmIds) {
    const email = farmEmails.get(farmProfileIds.get(farmId) ?? "") ?? null;
    const farmName = farmNames.get(farmId) ?? farmId;
    const leadId = await leadIdForEmail(email);
    if (!leadId) {
      skippedNoLead.push(`farm ${farmName}`);
      continue;
    }

    // welcome — once ever
    if (!(await touchpointRow("farm", farmId, "welcome"))) {
      const ok = await draft(
        leadId,
        "Welcome to CarboNature — you're now a customer",
        `Hi,\n\nGreat news — ${farmName} is now an active participant in the CarboNature project. Here's what happens this season: your plots' credits are calculated from the agri-inputs applied, and your share is recorded in our Allocation Register alongside CarboNature's. We'll keep you updated as activity progresses on your plots.\n\nWelcome aboard,\nRon\nCarboNature`,
      );
      if (ok) drafted++;
      await recordTouchpoint("farm", farmId, "welcome");
    }

    // activity update — on change only
    const currentStatus = latestActivityByFarm.get(farmId);
    if (currentStatus) {
      const prior = await touchpointRow("farm", farmId, "activity_update");
      if (!prior) {
        await recordTouchpoint("farm", farmId, "activity_update", currentStatus); // baseline, no message on first sight
      } else if (prior.last_seen_value !== currentStatus) {
        const ok = await draft(
          leadId,
          `${farmName} — activity update`,
          `Hi,\n\nAn update on ${farmName}'s participation: the current status is now "${currentStatus}". We'll keep you posted as it moves forward.\n\nRon\nCarboNature`,
        );
        if (ok) drafted++;
        await recordTouchpoint("farm", farmId, "activity_update", currentStatus);
      }
    }

    // unused-land nudge — quarterly
    const farmDetail = await fetchSaasFarm(farmId);
    const registeredArea = allPlots.filter((p) => p.farm_id === farmId).reduce((s, p) => s + Number(p.area_ha), 0);
    const cultivationArea = Number(farmDetail?.cultivation_area ?? 0);
    if (cultivationArea > registeredArea + 0.01) {
      const prior = await touchpointRow("farm", farmId, "unused_land_nudge");
      if (!prior || daysSince(prior.last_sent_at) >= 90) {
        const ok = await draft(
          leadId,
          `${farmName} — room to register another plot?`,
          `Hi,\n\nWe noticed ${farmName} has about ${(cultivationArea - registeredArea).toFixed(1)} ha of cultivation area not yet registered as a plot on the marketplace. If you'd like to make it available for funding, just let us know.\n\nRon\nCarboNature`,
        );
        if (ok) drafted++;
        await recordTouchpoint("farm", farmId, "unused_land_nudge");
      }
    }

    // annual impact summary
    const priorAnnual = await touchpointRow("farm", farmId, "annual_impact");
    if (!priorAnnual || daysSince(priorAnnual.last_sent_at) >= 350) {
      const totals = await query<{ potential: string | null }>(
        `SELECT SUM(credits_tco2e_potential) AS potential FROM mrv.allocation_register WHERE farm_id = $1 AND status <> 'released'`,
        [farmId],
      );
      const potential = Number(totals[0]?.potential ?? 0);
      const ok = await draft(
        leadId,
        `${farmName} — your year of impact`,
        `Hi,\n\nA look back at ${farmName}'s year: ${potential.toFixed(0)} tCO2e in credits generated on your plots so far (potential vector — real verified figures follow your first soil-sampling round). Thank you for being part of the project.\n\nRon\nCarboNature`,
      );
      if (ok) drafted++;
      await recordTouchpoint("farm", farmId, "annual_impact");
    }
  }

  // ---- Credit buyers -------------------------------------------------
  const buyerRows = await query<{ buyer_id: string; buyer_company_name: string }>(
    `SELECT DISTINCT ON (buyer_id) buyer_id, buyer_company_name FROM mrv.allocation_register WHERE status <> 'released' ORDER BY buyer_id`,
  );
  const buyerEmails = await listSaasProfileEmails(buyerRows.map((b) => b.buyer_id));

  for (const buyer of buyerRows) {
    const email = buyerEmails.get(buyer.buyer_id) ?? null;
    const leadId = await leadIdForEmail(email);
    if (!leadId) {
      skippedNoLead.push(`buyer ${buyer.buyer_company_name}`);
      continue;
    }

    const allocations = await query<{
      allocation_id: string;
      status: string;
      paid_at: string | null;
      cost_usd: string;
      source_reservation_id: string | null;
    }>(
      `SELECT allocation_id, status, paid_at, cost_usd, source_reservation_id FROM mrv.allocation_register WHERE buyer_id = $1 AND status <> 'released'`,
      [buyer.buyer_id],
    );

    // welcome — once ever, on first payment
    const hasPaid = allocations.some((a) => a.paid_at);
    if (hasPaid && !(await touchpointRow("buyer", buyer.buyer_id, "welcome"))) {
      const ok = await draft(
        leadId,
        "Thank you for your first CarboNature transaction",
        `Hi,\n\nThank you for funding your first project activity with CarboNature. I'm Ron, your point of contact going forward. Here's what to expect: MRV and verification (targeted within 36 months), then delivery of your credits (within 60 days of issuance, with a 5-year long-stop on the full contract quantity). I'll keep you updated as things progress.\n\nBest,\nRon\nCarboNature`,
      );
      if (ok) drafted++;
      await recordTouchpoint("buyer", buyer.buyer_id, "welcome");
    }

    // activity update — on change, via the reservations behind this buyer's Agri-Inputs allocations
    const reservationIds = [...new Set(allocations.map((a) => a.source_reservation_id).filter((x): x is string => !!x))];
    if (reservationIds.length) {
      const activity = await listActivityStatusByReservationIds(reservationIds);
      const latest = activity[0]?.current_status; // already ordered updated_at desc
      if (latest) {
        const prior = await touchpointRow("buyer", buyer.buyer_id, "activity_update");
        if (!prior) {
          await recordTouchpoint("buyer", buyer.buyer_id, "activity_update", latest);
        } else if (prior.last_seen_value !== latest) {
          const ok = await draft(
            leadId,
            `${buyer.buyer_company_name} — project progress update`,
            `Hi,\n\nAn update on your funded project activity: the current status is now "${latest}". You don't need to do anything — we'll keep you posted as it progresses toward delivery.\n\nRon\nCarboNature`,
          );
          if (ok) drafted++;
          await recordTouchpoint("buyer", buyer.buyer_id, "activity_update", latest);
        }
      }
    }

    // near-delivery reinvestment invite — pending_delivery, paid roughly
    // toward the 36-month verification milestone (an approximation, not
    // a real delivery-date signal, which doesn't exist yet anywhere).
    const nearDelivery = allocations.find((a) => a.status === "pending_delivery" && a.paid_at && daysSince(a.paid_at) >= 900);
    if (nearDelivery) {
      const prior = await touchpointRow("buyer", buyer.buyer_id, "near_delivery_invite");
      if (!prior || daysSince(prior.last_sent_at) >= 180) {
        const ok = await draft(
          leadId,
          `${buyer.buyer_company_name} — fund another block?`,
          `Hi,\n\nYour project is approaching its delivery milestone. If you'd like to fund another block or project ahead of that, I'd be glad to help set it up.\n\nRon\nCarboNature`,
        );
        if (ok) drafted++;
        await recordTouchpoint("buyer", buyer.buyer_id, "near_delivery_invite");
      }
    }

    // pre-deal KYC check — cumulative deal value crossing the enhanced-diligence threshold, still not cleared
    const totalCostUsd = allocations.reduce((s, a) => s + Number(a.cost_usd), 0);
    if (totalCostUsd >= 50_000) {
      const kyc = await query<{ status: string }>(`SELECT status FROM mrv.kyc_tracking WHERE buyer_id = $1`, [buyer.buyer_id]);
      if (kyc.length && kyc[0].status !== "cleared") {
        const prior = await touchpointRow("buyer", buyer.buyer_id, "pre_deal_kyc_check");
        if (!prior || daysSince(prior.last_sent_at) >= 30) {
          const ok = await draft(
            leadId,
            `${buyer.buyer_company_name} — enhanced KYC documents needed`,
            `Hi,\n\nYour cumulative funding with CarboNature has crossed USD 50,000, which means we need a few enhanced diligence documents before your next transaction: an ownership chart, board resolution, beneficial-owner identity documents, audited accounts, and your AML policy. Please send these to info@carbonature.io when convenient.\n\nRon\nCarboNature`,
          );
          if (ok) drafted++;
          await recordTouchpoint("buyer", buyer.buyer_id, "pre_deal_kyc_check");
        }
      }
    }

    // annual impact — only once real deliveries exist (status='delivered'); correctly dormant until then.
    if (allocations.some((a) => a.status === "delivered")) {
      const prior = await touchpointRow("buyer", buyer.buyer_id, "annual_impact");
      if (!prior || daysSince(prior.last_sent_at) >= 350) {
        const delivered = allocations.filter((a) => a.status === "delivered").length;
        const ok = await draft(
          leadId,
          `${buyer.buyer_company_name} — your year of real impact`,
          `Hi,\n\nA look back at your year with CarboNature: ${delivered} allocation(s) delivered in full. Thank you for funding real, verified climate impact.\n\nRon\nCarboNature`,
        );
        if (ok) drafted++;
        await recordTouchpoint("buyer", buyer.buyer_id, "annual_impact");
      }
    }
  }

  const paragraphs = [
    `Drafted ${drafted} retention message(s) across ${farmIds.length} farm(s) and ${buyerRows.length} buyer(s), all pending human approval in the CRM's own queue.`,
    `2 touchpoints are deliberately not implemented yet (no data source exists): 30-day dashboard-inactivity nudges (farmer + buyer), and the farmer seasonal pre-planting reminder.`,
  ];
  if (skippedNoLead.length) paragraphs.push(`${skippedNoLead.length} entit(y/ies) skipped — no matching CRM lead by email: ${skippedNoLead.join(", ")}.`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Retention sequence — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "retention_sequence",
    sendEmail: drafted > 0 || skippedNoLead.length > 0,
    agentId: "ron",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (drafted: ${drafted}.)` };
}
