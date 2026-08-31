import "server-only";
import type { LetterheadTable } from "../../../reports/letterheadPdf";
import type { PotentialData } from "./queries";

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export interface Chapter3Result {
  tables: LetterheadTable[];
  bodyParagraphs: string[];
  hasAnyRound: boolean;
}

/**
 * Chapter 3 — Actual Credit Allocation (Sections 6.1-6.3), per the
 * approved spec. There is genuinely no real Actual-vector data yet
 * anywhere in production (mrv.vcu_issuances / mrv.allocation_rounds both
 * empty today) — this renders the honest, correct empty state rather
 * than fabricating a round, and will populate automatically the first
 * time a real round is recorded (mrv.allocation_rounds, migration 0090).
 *
 * Balance-carry formula (Section 7.2, formalized 2026-08-31):
 * Available(N) = Verified(N) - SUM(Allocated(1..N-1)) — implemented as
 * `computeAvailablePool` below, called whenever a new round is created
 * (not yet wired to any UI — no round exists to create from today).
 */
export async function computeAvailablePool(projectId: string, grossVerifiedThisRound: number): Promise<number> {
  const { query } = await import("../../../db");
  const priorRounds = await query<{ total_allocated: string | null }>(
    `SELECT SUM(aa.net_farm_tco2e + aa.net_cn_tco2e + aa.net_buyer_tco2e) AS total_allocated
       FROM mrv.actual_allocations aa
       JOIN mrv.allocation_rounds r ON r.round_id = aa.round_id
      WHERE r.project_id = $1`,
    [projectId],
  );
  const alreadyAllocated = Number(priorRounds[0]?.total_allocated ?? 0);
  return grossVerifiedThisRound - alreadyAllocated;
}

export async function buildChapter3(data: PotentialData): Promise<Chapter3Result> {
  const { query } = await import("../../../db");

  const rounds = await query<{
    round_id: string;
    project_id: string;
    project_name: string;
    round_number: number;
    gross_verified_tco2e: string;
    available_pool_tco2e: string;
    status: string;
  }>(`SELECT round_id, project_id, project_name, round_number, gross_verified_tco2e, available_pool_tco2e, status FROM mrv.allocation_rounds ORDER BY project_id, round_number`);

  if (!rounds.length) {
    return {
      tables: [],
      bodyParagraphs: [
        "Chapter 3 (Actual Credit Allocation): no completed issuance round exists yet for any project — this section will populate automatically the first time a real mrv.vcu_issuances / mrv.allocation_rounds round is recorded. No fabricated figures are shown here.",
        "6.3 Actual vs Plan: not computable yet for the same reason (needs at least one real round). PLAN = the Potential Vector (Chapter 2), already available above; ACTUAL will appear here per farm once a round exists.",
      ],
      hasAnyRound: false,
    };
  }

  const tables: LetterheadTable[] = [];
  const planByFarm = new Map<string, { farmName: string; plan: number }>();
  for (const r of [...data.byProject.values()].flat()) {
    planByFarm.set(r.farmId, { farmName: r.farmName, plan: r.farmPotential });
  }
  const actualByFarm = new Map<string, number>();

  for (const round of rounds) {
    const allocs = await query<{
      farm_id: string | null;
      buyer_company_name: string | null;
      deal_type: string | null;
      verified_tco2e: string;
      offset_tco2e: string;
      net_farm_tco2e: string;
      net_cn_tco2e: string;
      net_buyer_tco2e: string;
    }>(`SELECT farm_id, buyer_company_name, deal_type, verified_tco2e, offset_tco2e, net_farm_tco2e, net_cn_tco2e, net_buyer_tco2e
          FROM mrv.actual_allocations WHERE round_id = $1`, [round.round_id]);

    const table: LetterheadTable = {
      title: `${round.project_name} - Allocation Round ${round.round_number} (${round.status.toUpperCase()})`,
      columns: [
        { header: "Farm / Buyer", width: 140 },
        { header: "Verified (VCU)", width: 70, align: "right" },
        { header: "Offset (VCU)", width: 60, align: "right" },
        { header: "Net Farm (VCU)", width: 60, align: "right" },
        { header: "Net CN (VCU)", width: 60, align: "right" },
      ],
      rows: allocs.map((a) => [
        a.farm_id ? (planByFarm.get(a.farm_id)?.farmName ?? a.farm_id) : (a.buyer_company_name ?? "-"),
        fmt(Number(a.verified_tco2e)),
        fmt(Number(a.offset_tco2e)),
        fmt(Number(a.net_farm_tco2e)),
        fmt(Number(a.net_cn_tco2e)),
      ]),
      boldRowIndexes: [],
      spacerRowIndexes: [],
      emphasisRowIndexes: [],
    };
    tables.push(table);

    for (const a of allocs) {
      if (!a.farm_id) continue;
      actualByFarm.set(a.farm_id, (actualByFarm.get(a.farm_id) ?? 0) + Number(a.net_farm_tco2e) + Number(a.net_cn_tco2e));
    }
  }

  const planVsActualRows: string[][] = [];
  let planTotal = 0;
  let actualTotal = 0;
  for (const [farmId, { farmName, plan }] of planByFarm) {
    const actual = actualByFarm.get(farmId);
    if (actual === undefined) continue;
    planTotal += plan;
    actualTotal += actual;
    const variance = actual - plan;
    const accuracy = plan > 0 ? (actual / plan) * 100 : 0;
    planVsActualRows.push([farmName, fmt(plan), fmt(actual), fmt(variance), `${accuracy.toFixed(1)}%`]);
  }
  if (planVsActualRows.length) {
    planVsActualRows.push([
      "TOTAL",
      fmt(planTotal),
      fmt(actualTotal),
      fmt(actualTotal - planTotal),
      `${planTotal > 0 ? ((actualTotal / planTotal) * 100).toFixed(1) : "0.0"}%`,
    ]);
    tables.push({
      title: "6.3 - Actual vs Plan (PLAN = Potential Vector, quantity only)",
      columns: [
        { header: "Farm", width: 140 },
        { header: "Plan (VCU)", width: 70, align: "right" },
        { header: "Actual (VCU)", width: 70, align: "right" },
        { header: "Variance (VCU)", width: 70, align: "right" },
        { header: "Accuracy %", width: 60, align: "right" },
      ],
      rows: planVsActualRows,
      boldRowIndexes: [],
      emphasisRowIndexes: [planVsActualRows.length - 1],
      spacerRowIndexes: [],
    });
  }

  return { tables, bodyParagraphs: [`Chapter 3: ${rounds.length} allocation round(s) on record.`], hasAnyRound: true };
}
