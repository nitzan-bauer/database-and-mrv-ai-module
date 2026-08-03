import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export type CarbonModel = "DNDC" | "DayCent";
export type ModelScenario = "baseline" | "project" | "paired";
export type UncertaintyMethod = "analytical" | "monte_carlo";

const MODELS: CarbonModel[] = ["DNDC", "DayCent"];
const SCENARIOS: ModelScenario[] = ["baseline", "project", "paired"];
const METHODS: UncertaintyMethod[] = ["analytical", "monte_carlo"];

/** One stratum's result as it comes out of the external model's own output file. */
export interface ModelResultRow {
  stratumId: string;
  deltaSocWpTHa?: number | null;
  deltaSocBslTHa?: number | null;
  varModel?: number | null;
  varSampling?: number | null;
}

export interface IngestModelResultsInput {
  farmId: string;
  cycleId?: string | null;
  model: CarbonModel;
  modelVersion?: string | null;
  parameterSet?: string | null;
  runType?: string | null;
  scenario?: ModelScenario;
  periodStart?: string | null;
  periodEnd?: string | null;
  uncertaintyMethod: UncertaintyMethod;
  monteCarloIters?: number | null;
  /** The model's own output file — kept as the source evidence, the same standing as a lab workbook. */
  outputFileUrl: string;
  outputFileSha256?: string | null;
  rows: ModelResultRow[];
}

export interface IngestedModelResults {
  runId: string;
  resultsCreated: number;
}

/**
 * Ingest a DNDC/DayCent run that already happened outside this repo.
 *
 * Neither model is integrated here, and this tool does not change that: it
 * never simulates or computes a stock-change figure, only records one a
 * real external run already produced, exactly the way ingestLabResults
 * records a lab's own measurements rather than computing SOC itself. The
 * output file is required for the same reason a lab workbook is required
 * there — it is the evidence a VVB's IME will want to trace a figure back
 * to (VMD0053), not a number this repo is vouching for on its own.
 *
 * Every stratum in the rows must actually belong to this farm; a result
 * for a stratum nobody has defined is refused outright rather than
 * silently accepted, the same discipline recordGroupedProjectDesign
 * applies to an eligibility area.
 */
export async function ingestModelResults(
  ctx: ToolContext,
  input: IngestModelResultsInput,
): Promise<ToolResult<IngestedModelResults>> {
  const guard = requireDbMode("ingestModelResults");
  if (guard) return guard;

  const policy = await checkPolicy("ingest_model_results", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.rows?.length) return fail("ingestModelResults: no per-stratum results to ingest.");
  if (!input.outputFileUrl?.trim()) {
    return fail(
      "ingestModelResults: the model's own output file must be kept — it is the source evidence a VVB's IME " +
        "will trace a figure back to; this tool ingests an external run, it never simulates one.",
    );
  }
  if (!MODELS.includes(input.model)) {
    return fail(`ingestModelResults: unknown model "${input.model}" — must be DNDC or DayCent.`);
  }
  if (!METHODS.includes(input.uncertaintyMethod)) {
    return fail(`ingestModelResults: unknown uncertaintyMethod "${input.uncertaintyMethod}".`);
  }
  const scenario = input.scenario ?? "paired";
  if (!SCENARIOS.includes(scenario)) {
    return fail(`ingestModelResults: unknown scenario "${scenario}".`);
  }
  if (input.monteCarloIters != null) {
    if (input.uncertaintyMethod !== "monte_carlo") {
      return fail("ingestModelResults: monteCarloIters only applies to the monte_carlo method.");
    }
    if (!(input.monteCarloIters > 0)) return fail("ingestModelResults: monteCarloIters must be positive.");
  }
  for (const [i, r] of input.rows.entries()) {
    if (!r.stratumId?.trim()) return fail(`ingestModelResults: row ${i + 1} has no stratumId.`);
    if (r.varModel != null && r.varModel < 0) return fail(`ingestModelResults: row ${i + 1} has a negative var_model.`);
    if (r.varSampling != null && r.varSampling < 0) {
      return fail(`ingestModelResults: row ${i + 1} has a negative var_sampling.`);
    }
  }

  const { query, withTransaction } = await import("../db");

  const farms = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.farms WHERE farm_id = $1`, [
    input.farmId,
  ]);
  if (Number(farms[0].n) === 0) return fail("ingestModelResults: no such farm.");

  const stratumIds = [...new Set(input.rows.map((r) => r.stratumId))];
  const owned = await query<{ stratum_id: string }>(
    `SELECT s.stratum_id FROM mrv.strata s JOIN mrv.plots p ON p.plot_id = s.plot_id
      WHERE p.farm_id = $1 AND s.stratum_id = ANY($2::uuid[])`,
    [input.farmId, stratumIds],
  );
  const ownedSet = new Set(owned.map((r) => r.stratum_id));
  const foreign = stratumIds.filter((id) => !ownedSet.has(id));
  if (foreign.length) {
    return fail(`ingestModelResults: these strata do not belong to this farm: ${foreign.join(", ")}`);
  }

  const result = await withTransaction(async (tx) => {
    const run = await tx.query<{ run_id: string }>(
      `INSERT INTO mrv.model_runs
         (farm_id, cycle_id, model, model_version, parameter_set, run_type, scenario,
          period_start, period_end, uncertainty_method, monte_carlo_iters,
          input_manifest, status, output_url, initiated_by, completed_at)
       VALUES ($1,$2,$3::mrv.carbon_model,$4,$5,$6,$7::mrv.model_scenario,
               $8,$9,$10,$11,$12::jsonb,'completed'::mrv.run_status,$13,$14,now())
       RETURNING run_id`,
      [
        input.farmId,
        input.cycleId ?? null,
        input.model,
        input.modelVersion ?? null,
        input.parameterSet ?? null,
        input.runType ?? null,
        scenario,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.uncertaintyMethod,
        input.monteCarloIters ?? null,
        JSON.stringify({ ingestedBy: ctx.actor, outputFileSha256: input.outputFileSha256 ?? null }),
        input.outputFileUrl.trim(),
        ctx.userId ?? null,
      ],
    );
    const runId = run.rows[0].run_id;

    let resultsCreated = 0;
    for (const r of input.rows) {
      await tx.query(
        `INSERT INTO mrv.model_results
           (run_id, stratum_id, delta_soc_wp_t_ha, delta_soc_bsl_t_ha, var_model, var_sampling)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [runId, r.stratumId, r.deltaSocWpTHa ?? null, r.deltaSocBslTHa ?? null, r.varModel ?? null, r.varSampling ?? null],
      );
      resultsCreated++;
    }

    return { runId, resultsCreated };
  });

  await audit(ctx, "ingest_model_results", { type: "model_run", id: result.runId }, {
    farmId: input.farmId,
    model: input.model,
    uncertaintyMethod: input.uncertaintyMethod,
    resultsCreated: result.resultsCreated,
    outputFileUrl: input.outputFileUrl.trim(),
  });

  return ok(result);
}
