import "server-only";
import { generatePlan, CORES_PER_COMPOSITE, MIN_COMPOSITES } from "../planner/generate";
import type { QuantApproach } from "../data/types";
import {
  audit,
  checkPolicy,
  fail,
  ok,
  requireDbMode,
  type ToolContext,
  type ToolResult,
} from "./context";

export interface CreatedPlan {
  cycleId: string;
  cycleNumber: number;
  strata: Array<{ stratumId: string; plotId: string; code: string; points: number }>;
  totalPoints: number;
  seed: number;
  collectTexture: boolean;
}

/**
 * Turn a generated plan into rows: strata, one cycle, and the points.
 *
 * The arithmetic already exists in planner/generate.ts and is unchanged
 * here — this is the part that makes it durable, which is what a VVB reads.
 *
 * Point placement
 * ---------------
 * VM0042 §8.2.1.2 requires stratified *random* sampling, so the points are
 * drawn with PostGIS ST_GeneratePoints rather than laid out on a grid. That
 * creates a difficulty for verification: a random draw cannot be checked by
 * repeating it. So the seed is chosen here, passed to ST_GeneratePoints, and
 * written to the audit log. The placement stays genuinely random, and anyone
 * can re-run the same call and get the same points back — which is what
 * distinguishes a random sample from one that was quietly re-drawn until it
 * looked convenient.
 *
 * Points land inside the plot geometry by construction, so no point can fall
 * outside the boundary it is meant to represent.
 *
 * The whole thing runs in one transaction. A half-written plan — strata with
 * no points, or a cycle with nothing under it — would be worse than none,
 * because the compliance engine would score it as a real but failing plan.
 */
export async function createSamplingPlan(
  ctx: ToolContext,
  input: {
    farmId: string;
    cycleNumber: number;
    approach: QuantApproach;
    cvByStratum?: Record<string, number>;
    plannedStart?: string | null;
    plannedEnd?: string | null;
    /** Supply to reproduce an earlier plan exactly. */
    seed?: number;
  },
): Promise<ToolResult<CreatedPlan>> {
  const guard = requireDbMode("createSamplingPlan");
  if (guard) return guard;

  const policy = await checkPolicy("propose_sampling_plan", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!Number.isInteger(input.cycleNumber) || input.cycleNumber < 1) {
    return fail("createSamplingPlan: cycleNumber must be a positive whole number.");
  }

  const { query, withTransaction } = await import("../db");

  const plots = await query<{ plot_id: string; area_ha: string; name: string }>(
    `SELECT plot_id, area_ha, name FROM mrv.plots WHERE farm_id = $1 ORDER BY plot_id`,
    [input.farmId],
  );
  if (!plots.length) {
    return fail("createSamplingPlan: that farm has no plots, so there is nothing to sample.");
  }

  const existing = await query<{ cycle_id: string }>(
    `SELECT cycle_id FROM mrv.sampling_cycles WHERE farm_id = $1 AND cycle_number = $2`,
    [input.farmId, input.cycleNumber],
  );
  if (existing.length) {
    return fail(
      `createSamplingPlan: cycle ${input.cycleNumber} already exists for this farm. ` +
        "Cycles are the unit a VVB verifies against, so a second one with the same number is refused.",
    );
  }

  const plan = generatePlan({
    plots: plots.map((p) => ({
      plotId: p.plot_id,
      areaHa: Number(p.area_ha),
      name: p.name,
    })) as never,
    cycleNumber: input.cycleNumber,
    approach: input.approach,
    cvByStratum: input.cvByStratum,
  });

  const below = plan.strata.filter((s) => s.points < MIN_COMPOSITES);
  if (below.length) {
    return fail(
      `createSamplingPlan: ${below.length} stratum/strata fall below the ${MIN_COMPOSITES}-composite floor ` +
        `(${below.map((s) => `${s.plotId}:${s.code}`).join(", ")}). VM0042 §8.2.1.2 sets that as a hard minimum.`,
    );
  }

  // 31 bits keeps it inside a signed int, which is what ST_GeneratePoints
  // takes for a seed.
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);

  const result = await withTransaction(async (tx) => {
    const cycle = await tx.query<{ cycle_id: string }>(
      `INSERT INTO mrv.sampling_cycles
         (farm_id, cycle_number, cycle_type, approach, collect_texture, texture_depth_cm,
          depth_scheme, planned_start, planned_end, confidence_alpha, power_1_minus_beta, mdd_target)
       VALUES ($1, $2, $3::mrv.cycle_type, $4::mrv.quant_approach, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING cycle_id`,
      [
        input.farmId,
        input.cycleNumber,
        input.cycleNumber === 1 ? "initial" : "true_up",
        input.approach,
        plan.collectTexture,
        plan.textureDepthCm,
        plan.depthScheme,
        input.plannedStart ?? null,
        input.plannedEnd ?? null,
        plan.confidenceAlpha,
        plan.power,
        plan.mddTarget,
      ],
    );
    const cycleId = cycle.rows[0].cycle_id;

    const strata: CreatedPlan["strata"] = [];
    let pointTotal = 0;

    for (const s of plan.strata) {
      // One stratum per plot for now, so it takes the plot's own geometry
      // and area. When texture stratification lands it will subdivide, and
      // the UNIQUE (plot_id, code) is what keeps that honest.
      const st = await tx.query<{ stratum_id: string }>(
        `INSERT INTO mrv.strata (plot_id, code, geom, area_ha)
         SELECT p.plot_id, $2, p.geom, p.area_ha FROM mrv.plots p WHERE p.plot_id = $1
         ON CONFLICT (plot_id, code) DO UPDATE SET updated_at = clock_timestamp()
         RETURNING stratum_id`,
        [s.plotId, s.code],
      );
      const stratumId = st.rows[0].stratum_id;

      // Random points inside the plot, from the recorded seed. The seed is
      // offset per stratum so two strata do not receive the same pattern.
      const inserted = await tx.query<{ n: string }>(
        `WITH pts AS (
           SELECT (ST_Dump(ST_GeneratePoints(p.geom, $3::int, $4::int))).geom AS g
             FROM mrv.plots p WHERE p.plot_id = $1
         )
         INSERT INTO mrv.sampling_points
           (plot_id, stratum_id, scenario, planned_geom, composite_cores, is_revisit, status)
         SELECT $1, $2, 'WP', g, $5, false, 'planned' FROM pts
         RETURNING 1`,
        [s.plotId, stratumId, s.points, (seed + strata.length) % 2 ** 31, CORES_PER_COMPOSITE],
      );

      const n = inserted.rowCount ?? 0;
      if (n !== s.points) {
        // ST_GeneratePoints returns fewer points than asked for if the
        // geometry is degenerate. Failing loudly beats a plan that silently
        // has four composites where the methodology needs five.
        throw new Error(
          `plot ${s.plotId}: asked for ${s.points} points, PostGIS placed ${n}. ` +
            "Check the plot polygon is valid and has area.",
        );
      }

      pointTotal += n;
      strata.push({ stratumId, plotId: s.plotId, code: s.code, points: n });
    }

    return { cycleId, strata, totalPoints: pointTotal };
  });

  await audit(ctx, "create_sampling_plan", { type: "sampling_cycle", id: result.cycleId }, {
    farmId: input.farmId,
    cycleNumber: input.cycleNumber,
    approach: input.approach,
    strata: result.strata.length,
    totalPoints: result.totalPoints,
    coresPerComposite: CORES_PER_COMPOSITE,
    // The seed is the reproducibility record: re-running with it returns
    // the identical point set.
    seed,
    rationale: plan.strata.map((s) => `${s.plotId}:${s.code} — ${s.rationale}`),
  });

  return ok({
    cycleId: result.cycleId,
    cycleNumber: input.cycleNumber,
    strata: result.strata,
    totalPoints: result.totalPoints,
    seed,
    collectTexture: plan.collectTexture,
  });
}
