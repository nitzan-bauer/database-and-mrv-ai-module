/**
 * The VM0042 §8.6.4 uncertainty deduction — Equation 74.
 *
 *     UNC(%) = t(0.667) × √Var(ERR) ÷ ERR × 100
 *
 * where ERR is the mean emission reduction or removal for the pool across
 * the project area (t CO2e/ha) and Var is the variance of that *mean*. It is
 * a probability-of-exceedance deduction: the figure carried forward is the
 * 33.3rd percentile of the estimated distribution, so the claim has roughly
 * a two-in-three chance of being exceeded by the truth rather than of
 * overstating it. Precision is therefore worth money — a tighter estimate
 * is deducted less.
 *
 * Two paths reach Var, and they differ in one detail that is easy to get
 * wrong (VMD0053; see docs/STAGE-6.md):
 *
 *   analytical   (Eqs. 60–64) only the sampling term is divided by area
 *   Monte Carlo  (Eqs. 65–69) the model term is divided by area as well
 *
 * That is why model and sampling variance are stored separately in
 * mrv.model_results rather than pre-combined — Eq. 74 is computed from
 * stored components, so a reported vintage stays reproducible.
 */

export type UncertaintyPath = "analytical" | "monte_carlo";

/**
 * One-sided Student's t at the 66.7% confidence interval (upper-tail
 * probability 1/3), by degrees of freedom. VM0042 states ≈ 0.4307 at large
 * sample sizes and asks for "degrees of freedom appropriate to the sampling
 * design used", so small designs take their own, larger, value.
 */
const T_667: Array<[df: number, t: number]> = [
  [1, 0.5774],
  [2, 0.4816],
  [3, 0.4592],
  [4, 0.4507],
  [5, 0.4470],
  [10, 0.4385],
  [20, 0.4344],
  [30, 0.4331],
  [60, 0.4319],
];

export const T_667_LARGE_SAMPLE = 0.4307;

export function tValue667(df: number): number {
  if (!Number.isFinite(df) || df < 1) return T_667_LARGE_SAMPLE;
  for (const [d, t] of T_667) if (df <= d) return t;
  return T_667_LARGE_SAMPLE;
}

export interface UncertaintyInputs {
  /** Mean ERR for the pool across the project area, t CO2e/ha (Eq. 74 ERR). */
  meanErrTHa: number;
  /** Model prediction-error variance, (t CO2e/ha)². */
  varModel: number;
  /** Sampling-design variance, (t CO2e/ha)². */
  varSampling: number;
  /** Project area in hectares — what the variance terms are divided by. */
  areaHa: number;
  path: UncertaintyPath;
  /** Degrees of freedom from the sampling design; omit for large-sample t. */
  degreesOfFreedom?: number;
}

export interface UncertaintyResult {
  /** Combined variance of the mean, after the per-path area division. */
  varMean: number;
  /** Standard error of the mean, t CO2e/ha. */
  standardError: number;
  tValue: number;
  /** Equation 74 deduction, %. */
  deductionPct: number;
  /** ERR after the deduction, t CO2e/ha. */
  netAfterDeductionTHa: number;
  path: UncertaintyPath;
}

/**
 * Equation 74. Returns a 100% deduction when the mean is zero or negative:
 * a reduction that cannot be distinguished from nothing cannot be claimed.
 */
export function equation74(i: UncertaintyInputs): UncertaintyResult {
  // A zero/negative area is bad input, not a "no area yet" case with a
  // sane default — silently substituting 1 here previously let a bad
  // zero-area stratum (mrv.strata.area_ha has no CHECK > 0) understate a
  // real Eq. 74 deduction with no trace of what happened. Callers must
  // validate area at their own boundary (see computeUncertaintyDeduction.ts);
  // this throws rather than guessing.
  if (!(i.areaHa > 0)) {
    throw new Error(`equation74: areaHa must be > 0, got ${i.areaHa}.`);
  }
  const t = tValue667(i.degreesOfFreedom ?? Number.POSITIVE_INFINITY);
  const area = i.areaHa;

  // The one detail that separates the two paths.
  const varMean =
    i.path === "monte_carlo"
      ? (i.varModel + i.varSampling) / area
      : i.varModel + i.varSampling / area;

  const standardError = Math.sqrt(Math.max(0, varMean));

  if (!(i.meanErrTHa > 0)) {
    return {
      varMean,
      standardError,
      tValue: t,
      deductionPct: 100,
      netAfterDeductionTHa: 0,
      path: i.path,
    };
  }

  const raw = ((t * standardError) / i.meanErrTHa) * 100;
  // A deduction cannot exceed the claim itself.
  const deductionPct = Math.min(100, Math.round(raw * 1000) / 1000);
  const netAfterDeductionTHa =
    Math.round(i.meanErrTHa * (1 - deductionPct / 100) * 10_000) / 10_000;

  return { varMean, standardError, tValue: t, deductionPct, netAfterDeductionTHa, path: i.path };
}

/**
 * The inverse: the variance of the mean that would produce a given
 * deduction. Used to state what precision a target deduction demands —
 * "to get under 10%, the standard error must be below X".
 */
export function varianceForDeduction(
  meanErrTHa: number,
  deductionPct: number,
  degreesOfFreedom?: number,
): number {
  const t = tValue667(degreesOfFreedom ?? Number.POSITIVE_INFINITY);
  const se = (deductionPct / 100) * meanErrTHa / t;
  return se * se;
}

/** Net SOC change for a stratum, mirroring model_results.net_t_ha. */
export function netTHa(deltaWp: number | null, deltaBsl: number | null): number {
  return Math.round(((deltaWp ?? 0) - (deltaBsl ?? 0)) * 10_000) / 10_000;
}
