import "server-only";
import type { PotentialData } from "./queries";

interface BalanceCheck {
  scopeType: "farm" | "project_cn";
  scopeId: string;
  projectId: string;
  label: string;
  balancePct: number;
}

export interface NegativeBalanceResult {
  newAlerts: string[];
  cleared: string[];
  activeBlocks: { projectId: string; blocksAgriInputs: boolean; blocksProjectFunding: boolean }[];
}

/**
 * Section 7.3 — negative-balance protection. Computed fresh every report
 * run (the "compute... check thresholds... send alerts/blocks" step,
 * Section 8, step 3) against the SAME farm/project rows the report
 * itself renders (queries.ts's PotentialData), so the alert and the
 * report can never silently disagree about a balance.
 *
 * Option B (Nitzan's explicit choice, 2026-08-31): at CarboNature's 20%
 * threshold, BOTH financing tracks are blocked for that project — not
 * just Project Funding. A farm's own 20% threshold only ever blocks
 * Agri Inputs (a farm has no Project Funding deals to block).
 */
export async function computeAndApplyNegativeBalanceFlags(data: PotentialData): Promise<NegativeBalanceResult> {
  const { query } = await import("../../../db");

  const checks: BalanceCheck[] = [];

  for (const r of [...data.byProject.values()].flat()) {
    const farmShare = r.farmPotential * r.farmerSharePct;
    const balancePct = farmShare > 0 ? (r.farmCredits / farmShare) * 100 : 100;
    checks.push({ scopeType: "farm", scopeId: r.farmId, projectId: r.projectId, label: r.farmName, balancePct });
  }

  for (const key of data.projectOrder) {
    const farms = data.byProject.get(key) ?? [];
    if (!farms.length) continue;
    const cnGrossShareTotal = farms.reduce((s, r) => s + r.farmPotential * (1 - r.farmerSharePct), 0);
    const cnNetBeforePF = farms.reduce((s, r) => s + r.cnCredits, 0);
    const pfDraw = data.projectLevelDeals.get(key)?.credits ?? 0;
    const cnNetFinal = cnNetBeforePF - pfDraw;
    const balancePct = cnGrossShareTotal > 0 ? (cnNetFinal / cnGrossShareTotal) * 100 : 100;
    checks.push({ scopeType: "project_cn", scopeId: farms[0].projectId, projectId: farms[0].projectId, label: `CarboNature (${key})`, balancePct });
  }

  const newAlerts: string[] = [];
  const cleared: string[] = [];
  const activeBlocks: NegativeBalanceResult["activeBlocks"] = [];

  for (const c of checks) {
    const desiredThresholds = new Set<number>();
    if (c.balancePct <= 30) desiredThresholds.add(30);
    if (c.balancePct <= 20) desiredThresholds.add(20);

    const existing = await query<{ threshold_pct: number }>(
      `SELECT threshold_pct FROM mrv.negative_balance_flags WHERE scope_type = $1 AND scope_id = $2 AND status = 'active'`,
      [c.scopeType, c.scopeId],
    );
    const existingThresholds = new Set(existing.map((e) => e.threshold_pct));

    for (const threshold of [30, 20]) {
      const wants = desiredThresholds.has(threshold);
      const has = existingThresholds.has(threshold);
      if (wants && !has) {
        const blocksAgriInputs = threshold === 20;
        const blocksProjectFunding = threshold === 20 && c.scopeType === "project_cn";
        await query(
          `INSERT INTO mrv.negative_balance_flags
             (scope_type, scope_id, project_id, threshold_pct, balance_pct_at_trigger, blocks_agri_inputs, blocks_project_funding)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [c.scopeType, c.scopeId, c.projectId, threshold, c.balancePct, blocksAgriInputs, blocksProjectFunding],
        );
        newAlerts.push(
          `${c.label}: balance at ${c.balancePct.toFixed(1)}% (<=${threshold}%) - ${
            threshold === 20 ? (c.scopeType === "project_cn" ? "new Project Funding AND Agri Inputs deals blocked for this project" : "new Agri Inputs deals blocked for this farm") : "alert only"
          }.`,
        );
      } else if (!wants && has) {
        await query(
          `UPDATE mrv.negative_balance_flags SET status = 'cleared', cleared_at = now()
           WHERE scope_type = $1 AND scope_id = $2 AND threshold_pct = $3 AND status = 'active'`,
          [c.scopeType, c.scopeId, threshold],
        );
        cleared.push(`${c.label}: balance recovered above ${threshold}% (now ${c.balancePct.toFixed(1)}%) - flag cleared.`);
      }
    }
  }

  const activeBlockRows = await query<{ project_id: string; blocks_agri_inputs: boolean; blocks_project_funding: boolean }>(
    `SELECT DISTINCT project_id, blocks_agri_inputs, blocks_project_funding
       FROM mrv.negative_balance_flags
      WHERE status = 'active' AND scope_type = 'project_cn' AND (blocks_agri_inputs OR blocks_project_funding)`,
  );
  for (const row of activeBlockRows) {
    activeBlocks.push({ projectId: row.project_id, blocksAgriInputs: row.blocks_agri_inputs, blocksProjectFunding: row.blocks_project_funding });
  }

  return { newAlerts, cleared, activeBlocks };
}
