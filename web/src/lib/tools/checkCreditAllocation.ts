import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface CreditQaIssue {
  code:
    | "APPLICATION_AREA_EXCEEDS_PLOT"
    | "DUPLICATE_VINTAGE_ACTIVITY"
    | "MISSING_VINTAGE_FOR_ISSUED"
    | "VCU_ISSUANCE_EXCEEDS_CREDITS";
  detail: string;
}

export interface CreditAllocationQaResult {
  projectId: string;
  creditsChecked: number;
  issues: CreditQaIssue[];
}

/**
 * John's credit_allocation_qa skill — the same standing as Rebeka's
 * run_plot_qa_qc: read-only checks over real rows in mrv.credits and
 * mrv.vcu_issuances, real rows only (demo excluded, matching
 * mrv.v_plot_credits's own convention).
 *
 * Four checks, none of them needing a model:
 *
 *   - a credit's application_area_ha cannot exceed the plot it sits on —
 *     the same physical-impossibility check run_plot_qa_qc already runs
 *     on the plot itself, applied to what was actually credited against it.
 *   - the same plot/activity/vintage combination should not appear as
 *     more than one credit line — that would be the same physical
 *     activity counted twice toward the same vintage.
 *   - a credit that has moved past 'estimated' (verified/issued/
 *     retired/sold) must carry a vintage_year — a real Verra issuance
 *     is always dated, so a missing one is a bookkeeping gap.
 *   - VCUs actually issued for a vintage cannot exceed what the
 *     project's own credits (issued/retired/sold) support for that
 *     vintage — the arithmetic check that prevents issuing more units
 *     than the project's own ledger backs.
 *
 * A clean result says the allocation is internally consistent — the
 * same precondition run_plot_qa_qc states about boundaries, applied to
 * the commercial side of the pipeline.
 */
export async function checkCreditAllocation(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<CreditAllocationQaResult>> {
  const guard = requireDbMode("checkCreditAllocation");
  if (guard) return guard;

  const policy = await checkPolicy("credit_allocation_qa", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("checkCreditAllocation: no such project.");

  const credits = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.credits c
       JOIN mrv.plots p ON p.plot_id = c.plot_id
       JOIN mrv.farms f ON f.farm_id = p.farm_id
      WHERE f.project_id = $1 AND NOT c.is_demo`,
    [input.projectId],
  );
  const creditsChecked = Number(credits[0].n);
  if (creditsChecked === 0) return fail("checkCreditAllocation: this project has no real credits to check.");

  const issues: CreditQaIssue[] = [];

  const overArea = await query<{ credit_id: string; plot_id: string; plot_area_ha: string; application_area_ha: string }>(
    `SELECT c.credit_id, c.plot_id, p.area_ha AS plot_area_ha, c.application_area_ha
       FROM mrv.credits c
       JOIN mrv.plots p ON p.plot_id = c.plot_id
       JOIN mrv.farms f ON f.farm_id = p.farm_id
      WHERE f.project_id = $1 AND NOT c.is_demo AND NOT p.is_demo
        AND p.area_ha IS NOT NULL AND c.application_area_ha > p.area_ha`,
    [input.projectId],
  );
  for (const r of overArea) {
    issues.push({
      code: "APPLICATION_AREA_EXCEEDS_PLOT",
      detail: `credit ${r.credit_id} on plot ${r.plot_id}: application area ${Number(r.application_area_ha).toFixed(2)} ha exceeds the plot's own ${Number(r.plot_area_ha).toFixed(2)} ha`,
    });
  }

  const duplicates = await query<{ plot_id: string; activity_id: string; vintage_year: number; n: string; credit_ids: string[] }>(
    `SELECT c.plot_id, c.activity_id, c.vintage_year, count(*)::text n, array_agg(c.credit_id) AS credit_ids
       FROM mrv.credits c
       JOIN mrv.plots p ON p.plot_id = c.plot_id
       JOIN mrv.farms f ON f.farm_id = p.farm_id
      WHERE f.project_id = $1 AND NOT c.is_demo
        AND c.activity_id IS NOT NULL AND c.vintage_year IS NOT NULL
      GROUP BY c.plot_id, c.activity_id, c.vintage_year
     HAVING count(*) > 1`,
    [input.projectId],
  );
  for (const r of duplicates) {
    issues.push({
      code: "DUPLICATE_VINTAGE_ACTIVITY",
      detail: `plot ${r.plot_id}, activity ${r.activity_id}, vintage ${r.vintage_year}: ${r.n} credit lines (${r.credit_ids.join(", ")}) — the same activity counted more than once toward the same vintage`,
    });
  }

  const missingVintage = await query<{ credit_id: string; plot_id: string; status: string }>(
    `SELECT c.credit_id, c.plot_id, c.status::text AS status
       FROM mrv.credits c
       JOIN mrv.plots p ON p.plot_id = c.plot_id
       JOIN mrv.farms f ON f.farm_id = p.farm_id
      WHERE f.project_id = $1 AND NOT c.is_demo
        AND c.status <> 'estimated' AND c.vintage_year IS NULL`,
    [input.projectId],
  );
  for (const r of missingVintage) {
    issues.push({
      code: "MISSING_VINTAGE_FOR_ISSUED",
      detail: `credit ${r.credit_id} on plot ${r.plot_id} is '${r.status}' but has no vintage_year`,
    });
  }

  const creditsByVintage = await query<{ vintage_year: number; credits_total: string }>(
    `SELECT c.vintage_year, sum(c.credits_tco2e)::text AS credits_total
       FROM mrv.credits c
       JOIN mrv.plots p ON p.plot_id = c.plot_id
       JOIN mrv.farms f ON f.farm_id = p.farm_id
      WHERE f.project_id = $1 AND NOT c.is_demo
        AND c.status IN ('issued', 'retired', 'sold') AND c.vintage_year IS NOT NULL
      GROUP BY c.vintage_year`,
    [input.projectId],
  );
  const creditTotalByVintage = new Map(creditsByVintage.map((r) => [r.vintage_year, Number(r.credits_total)]));

  const issuedByVintage = await query<{ vintage: number; issued_total: string }>(
    `SELECT vintage, sum(quantity_tco2e)::text AS issued_total
       FROM mrv.vcu_issuances
      WHERE project_id = $1 AND NOT is_demo AND vintage IS NOT NULL AND quantity_tco2e IS NOT NULL
      GROUP BY vintage`,
    [input.projectId],
  );
  for (const r of issuedByVintage) {
    const issuedTotal = Number(r.issued_total);
    const creditsTotal = creditTotalByVintage.get(r.vintage) ?? 0;
    if (issuedTotal > creditsTotal + 0.0001) {
      issues.push({
        code: "VCU_ISSUANCE_EXCEEDS_CREDITS",
        detail: `vintage ${r.vintage}: ${issuedTotal.toFixed(4)} tCO2e issued vs ${creditsTotal.toFixed(4)} tCO2e in issued/retired/sold credits`,
      });
    }
  }

  await audit(ctx, "credit_allocation_qa", { type: "project", id: input.projectId }, {
    creditsChecked,
    issuesFound: issues.length,
    issues: issues.map((i) => i.code),
  });

  return ok({ projectId: input.projectId, creditsChecked, issues });
}
