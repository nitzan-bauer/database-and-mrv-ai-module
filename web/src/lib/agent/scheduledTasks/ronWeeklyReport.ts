import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import type { LetterheadTable } from "../../reports/letterheadPdf";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "ron_weekly_report";

function round(n: number | string | null | undefined): number {
  return Math.round(Number(n ?? 0));
}
function fmt(n: number | string | null | undefined): string {
  return round(n).toLocaleString("en-US");
}
const HA_TO_DUNAM = 10; // 1 hectare = 10 dunam

/**
 * Ron's weekly CRM report (Phase 5/6 of the approved plan) — tables, not
 * prose, from the start (learning directly from the fix John's report
 * needed on 2026-08-26). Four sections: CRM pipeline by stage, this
 * week's retention activity, farmer land/activity per plot (in dunam,
 * per Nitzan's own unit), and customer value — read-only from
 * mrv.allocation_register (the same authoritative figure John's own
 * report uses), never recomputed independently or written back to.
 */
export async function runRonWeeklyReport(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { crmQuery } = await import("../../crmDb");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const { listFarmNamesByIds, listAllSaasPlots, fetchSaasFarm } = await import("../../saas/saasClient");

  const pipeline = await crmQuery<{ lead_type: string; current_stage: string; n: string }>(
    `SELECT lead_type, current_stage, count(*) AS n FROM crm.leads GROUP BY lead_type, current_stage ORDER BY lead_type, current_stage`,
  );

  const retentionActivity = await query<{ touchpoint_key: string; entity_type: string; n: string }>(
    `SELECT touchpoint_key, entity_type, count(*) AS n FROM mrv.retention_touchpoints
      WHERE last_sent_at >= now() - interval '7 days' GROUP BY touchpoint_key, entity_type ORDER BY entity_type, touchpoint_key`,
  );

  const farmRows = await query<{ farm_id: string }>(
    `SELECT DISTINCT farm_id FROM mrv.allocation_register WHERE farm_id IS NOT NULL AND status <> 'released'`,
  );
  const farmIds = farmRows.map((r) => r.farm_id);
  const [farmNames, allPlots] = await Promise.all([listFarmNamesByIds(farmIds), listAllSaasPlots()]);

  const customerValue = await query<{ buyer_company_name: string; total: string }>(
    `SELECT buyer_company_name, SUM(cost_usd) AS total FROM mrv.allocation_register WHERE status <> 'released' GROUP BY buyer_company_name ORDER BY total DESC`,
  );

  const tables: LetterheadTable[] = [];

  tables.push({
    title: "CRM pipeline — by stage",
    columns: [
      { header: "Lead type", width: 90 },
      { header: "Stage", width: 160 },
      { header: "#", width: 40, align: "right" },
    ],
    rows: pipeline.map((p) => [p.lead_type, p.current_stage, p.n]),
  });

  tables.push({
    title: "Retention activity — last 7 days",
    columns: [
      { header: "Entity", width: 70 },
      { header: "Touchpoint", width: 150 },
      { header: "Drafted", width: 60, align: "right" },
    ],
    rows: retentionActivity.length ? retentionActivity.map((r) => [r.entity_type, r.touchpoint_key, r.n]) : [["-", "no activity this week", "0"]],
  });

  const farmLandRows: string[][] = [];
  for (const farmId of farmIds) {
    const detail = await fetchSaasFarm(farmId);
    const registeredHa = allPlots.filter((p) => p.farm_id === farmId).reduce((s, p) => s + Number(p.area_ha), 0);
    const cultivationHa = Number(detail?.cultivation_area ?? 0);
    farmLandRows.push([
      farmNames.get(farmId) ?? farmId,
      fmt(cultivationHa * HA_TO_DUNAM),
      fmt(registeredHa * HA_TO_DUNAM),
      fmt((cultivationHa - registeredHa) * HA_TO_DUNAM),
    ]);
  }
  tables.push({
    title: "Farmer land — dunam",
    columns: [
      { header: "Farm", width: 150 },
      { header: "Total land", width: 90, align: "right" },
      { header: "Registered", width: 90, align: "right" },
      { header: "Unregistered", width: 90, align: "right" },
    ],
    rows: farmLandRows.length ? farmLandRows : [["No farms with active deals yet", "-", "-", "-"]],
  });

  const totalValue = customerValue.reduce((s, c) => s + Number(c.total), 0);
  const valueRows = customerValue.map((c) => [c.buyer_company_name, `$${fmt(c.total)}`]);
  valueRows.push(["TOTAL", `$${fmt(totalValue)}`]);
  tables.push({
    title: "Customer value (read-only, from John's Allocation Register)",
    columns: [
      { header: "Buyer", width: 220 },
      { header: "Total value", width: 100, align: "right" },
    ],
    rows: valueRows,
    boldRowIndexes: [valueRows.length - 1],
  });

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Ron's weekly CRM report — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: [`${pipeline.reduce((s, p) => s + Number(p.n), 0)} total lead(s) in the pipeline, ${customerValue.length} paying buyer(s), $${fmt(totalValue)} total customer value.`],
    tables,
    memoryKind: "ron_weekly_report",
    sendEmail: true,
    agentId: "ron",
  });

  return outcome;
}
