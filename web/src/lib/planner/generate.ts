/**
 * Sampling-plan generator — the manual statistical rules (spec §6.4).
 *
 * Tier 1 generates plans from explicit rules, not a model: the numbers must
 * be defensible to a VVB line by line. Dave's Stratification skill (Tier 2)
 * will call this same function so the human and agent paths cannot drift.
 *
 * The binding rule is VM0042 §8.2.1.2, which sets a floor of "at least 3–5
 * composite samples within each stratum". Spec v2.0 takes the conservative
 * end: MIN_COMPOSITES = 5, matched by mrv.evaluate_compliance() (migration
 * 0018), so the planner can never propose a cycle the engine would fail.
 */

import type { Plot, QuantApproach } from "@/lib/data/types";

/** Spec v2.0 floor — mirrored by the compliance engine. */
export const MIN_COMPOSITES = 5;

/** Cores composited into one sample at a point (§8.2.1.3). */
export const CORES_PER_COMPOSITE = 5;

export interface PlanInputs {
  plots: Plot[];
  cycleNumber: number;
  approach: QuantApproach;
  /** Coefficient of variation per stratum, if a prior cycle measured it. */
  cvByStratum?: Record<string, number>;
  confidenceAlpha?: number;
  power?: number;
  /** Minimum detectable difference, t SOC/ha. */
  mddTarget?: number;
}

export interface StratumPlan {
  /** stratum code within the plot, e.g. 'A' */
  code: string;
  plotId: string;
  areaHa: number;
  /** points allocated to this stratum */
  points: number;
  /** why this number, in words a VVB can follow */
  rationale: string;
  cv: number | null;
}

export interface GeneratedPlan {
  cycleNumber: number;
  approach: QuantApproach;
  strata: StratumPlan[];
  totalPoints: number;
  /** cycle 1 characterises variance and defines the strata */
  collectTexture: boolean;
  textureDepthCm: number;
  depthScheme: string;
  confidenceAlpha: number;
  power: number;
  mddTarget: number;
  coresPerComposite: number;
  /** hard checks the generator applied to itself */
  checks: PlanCheck[];
}

export interface PlanCheck {
  code: string;
  label: string;
  ref: string;
  passed: boolean;
  detail: string;
}

/**
 * Points per stratum. The floor is MIN_COMPOSITES; area and measured
 * variability can only add to it, never subtract.
 *
 *  - area:  +1 point per full 25 ha beyond the first 25, capped at +4, so a
 *           large stratum is not represented by the same 5 points as a small
 *           one (§8.2.1.2 "should be maximized").
 *  - CV:    +1 where a prior cycle measured CV > 30%, +2 where > 45% — the
 *           soft HIGH_CV warning turned into an action for the next cycle.
 */
export function pointsForStratum(areaHa: number, cv: number | null): {
  points: number;
  rationale: string;
} {
  const areaBonus = Math.min(4, Math.max(0, Math.floor((areaHa - 25) / 25) + (areaHa > 25 ? 1 : 0)));
  const cvBonus = cv == null ? 0 : cv > 0.45 ? 2 : cv > 0.3 ? 1 : 0;
  const points = MIN_COMPOSITES + areaBonus + cvBonus;

  const parts = [`${MIN_COMPOSITES} floor (§8.2.1.2)`];
  if (areaBonus) parts.push(`+${areaBonus} for ${areaHa.toFixed(1)} ha`);
  if (cvBonus) parts.push(`+${cvBonus} for CV ${((cv ?? 0) * 100).toFixed(0)}%`);
  return { points, rationale: parts.join(" · ") };
}

/**
 * Generate a stratified-random plan. Until strata are drawn (Slice 3+ in the
 * field), each plot is treated as one stratum — which is what the database
 * does too when a plot has no strata rows yet.
 */
export function generatePlan(inputs: PlanInputs): GeneratedPlan {
  const {
    plots,
    cycleNumber,
    approach,
    cvByStratum = {},
    confidenceAlpha = 0.9,
    power = 0.8,
    mddTarget = 0.5,
  } = inputs;

  const strata: StratumPlan[] = plots.map((p) => {
    const code = "A"; // one stratum per plot until texture stratification runs
    const key = `${p.plotId}:${code}`;
    const cv = cvByStratum[key] ?? null;
    const { points, rationale } = pointsForStratum(p.areaHa, cv);
    return { code, plotId: p.plotId, areaHa: p.areaHa, points, rationale, cv };
  });

  const totalPoints = strata.reduce((s, x) => s + x.points, 0);
  const collectTexture = cycleNumber === 1;

  const checks: PlanCheck[] = [
    {
      code: "STRATIFIED_RANDOM",
      label: "Stratified random sampling",
      ref: "§8.2.1.2",
      passed: strata.length > 0,
      detail: `${strata.length} strata across ${plots.length} plots`,
    },
    {
      code: "MIN_5_COMPOSITES",
      label: `≥ ${MIN_COMPOSITES} composites per stratum`,
      ref: "§8.2.1.2",
      passed: strata.every((s) => s.points >= MIN_COMPOSITES),
      detail: `${strata.filter((s) => s.points < MIN_COMPOSITES).length} strata below ${MIN_COMPOSITES}`,
    },
    {
      code: "ESM_TWO_INCREMENTS",
      label: "Two depth increments (ESM)",
      ref: "§8.2.1.6",
      passed: true,
      detail: "0–15 / 15–30 cm at every point",
    },
    {
      code: "FIRST_ROUND_TEXTURE",
      label: "Texture test at every first-round point",
      ref: "§8.2.1.2",
      passed: !collectTexture || strata.length > 0,
      detail: collectTexture
        ? `${totalPoints} texture samples at 15 cm — drives stratification`
        : "not a first cycle — texture already characterised",
    },
    {
      code: "SAME_SEASON",
      label: "Same-season window",
      ref: "§8.2.1.1",
      passed: true,
      detail: "window set on the cycle; enforced at work-order issue",
    },
  ];

  return {
    cycleNumber,
    approach,
    strata,
    totalPoints,
    collectTexture,
    textureDepthCm: 15,
    depthScheme: "0-15/15-30",
    confidenceAlpha,
    power,
    mddTarget,
    coresPerComposite: CORES_PER_COMPOSITE,
    checks,
  };
}

/**
 * Dave's recommendation over a generated plan. In Tier 1 this is the same
 * deterministic reasoning the agent will later phrase itself — surfaced so
 * the planner shows *why*, not just *how many*.
 */
export function recommendation(plan: GeneratedPlan): {
  headline: string;
  reasons: string[];
} {
  const reasons: string[] = [];
  const highCv = plan.strata.filter((s) => s.cv != null && s.cv > 0.3);
  const large = plan.strata.filter((s) => s.areaHa > 50);

  if (highCv.length)
    reasons.push(
      `${highCv.length} stratum/strata carry CV > 30% — extra points added there to hold the uncertainty deduction down.`,
    );
  if (large.length)
    reasons.push(
      `${large.length} stratum/strata exceed 50 ha; area-scaled allocation keeps per-hectare coverage even.`,
    );
  if (plan.collectTexture)
    reasons.push(
      "First cycle: every point also carries a soil-texture test at 15 cm, which defines the strata for all later cycles.",
    );
  if (!reasons.length)
    reasons.push("No prior variance data — the plan sits at the floor, which is the conservative start.");

  reasons.push(
    `MDD target ${plan.mddTarget} t SOC/ha at α ${plan.confidenceAlpha} / power ${plan.power}; ${plan.coresPerComposite} cores per composite.`,
  );

  return {
    headline: `${plan.totalPoints} points across ${plan.strata.length} strata`,
    reasons,
  };
}
