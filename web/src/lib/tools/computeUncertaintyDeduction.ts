import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { equation74, type UncertaintyPath, type UncertaintyResult } from "../model/uncertainty";

export interface UncertaintyDeductionResult extends UncertaintyResult {
  farmId: string;
  runId: string;
  strataCounted: number;
  totalAreaHa: number;
  meanNetTHa: number;
}

/**
 * Dave's uncertainty_deduction skill — VM0042 Eq. 74 over a farm's most
 * recent completed model run, the same pattern as the GHG-Calculator pilot:
 * the engine (equation74) is a plain, already-verified function; this is a
 * thin wrapper that feeds it real stored numbers instead of asking a model
 * to supply variance terms it has no way to know.
 *
 * mrv.model_results stores var_model and var_sampling per stratum
 * separately rather than pre-combined (see uncertainty.ts) precisely so
 * this can compute Eq. 74 from what was actually stored at run time,
 * area-weighted across strata the same way the Model Run Console does.
 */
export async function computeUncertaintyDeduction(
  ctx: ToolContext,
  input: { farmId: string; path?: UncertaintyPath; degreesOfFreedom?: number },
): Promise<ToolResult<UncertaintyDeductionResult>> {
  const guard = requireDbMode("computeUncertaintyDeduction");
  if (guard) return guard;

  const policy = await checkPolicy("compute_uncertainty_deduction", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");

  const runs = await query<{ run_id: string; uncertainty_method: UncertaintyPath | null }>(
    `SELECT run_id, uncertainty_method FROM mrv.model_runs
      WHERE farm_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [input.farmId],
  );
  if (!runs.length) return fail("computeUncertaintyDeduction: this farm has no completed model run yet.");
  const { run_id, uncertainty_method } = runs[0];

  const rows = await query<{
    net_t_ha: string;
    var_model: string | null;
    var_sampling: string | null;
    area_ha: string | null;
  }>(
    `SELECT r.net_t_ha, r.var_model, r.var_sampling, s.area_ha
       FROM mrv.model_results r
       JOIN mrv.strata s ON s.stratum_id = r.stratum_id
      WHERE r.run_id = $1`,
    [run_id],
  );

  const usable = rows.filter((r) => r.area_ha != null && r.var_model != null && r.var_sampling != null);
  if (!usable.length) {
    return fail(
      "computeUncertaintyDeduction: that run has no results with area and variance recorded yet — cannot score.",
    );
  }

  const totalArea = usable.reduce((s, r) => s + Number(r.area_ha), 0);
  const meanNet = usable.reduce((s, r) => s + Number(r.net_t_ha) * Number(r.area_ha), 0) / (totalArea || 1);
  const varModel = usable.reduce((s, r) => s + Number(r.var_model) * Number(r.area_ha), 0) / (totalArea || 1);
  const varSampling = usable.reduce((s, r) => s + Number(r.var_sampling) * Number(r.area_ha), 0) / (totalArea || 1);

  const path = input.path ?? uncertainty_method ?? "monte_carlo";

  const result = equation74({
    meanErrTHa: meanNet,
    varModel,
    varSampling,
    areaHa: totalArea,
    path,
    degreesOfFreedom: input.degreesOfFreedom,
  });

  const data: UncertaintyDeductionResult = {
    ...result,
    farmId: input.farmId,
    runId: run_id,
    strataCounted: usable.length,
    totalAreaHa: Math.round(totalArea * 10_000) / 10_000,
    meanNetTHa: Math.round(meanNet * 10_000) / 10_000,
  };

  await audit(ctx, "compute_uncertainty_deduction", { type: "model_run", id: run_id }, {
    farmId: input.farmId,
    strataCounted: usable.length,
    path,
    deductionPct: result.deductionPct,
  });

  return ok(data);
}
