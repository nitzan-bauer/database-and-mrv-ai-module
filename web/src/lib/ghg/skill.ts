import {
  computeEmissions,
  efNDirect,
  emissionReduction,
  fracLeach,
  showWorking,
  type ActivityData,
  type EmissionResult,
  type GhgParameters,
} from "./engine";

/**
 * Dave's GHG-Calculator skill — the Tier-2 pattern, piloted in Tier 1.
 *
 * The agreed shape for every agent skill is: the engine is a plain, tested
 * function; the skill is a thin, declared tool surface over it; and Tier 2
 * only adds orchestration and language. Nothing here calls a model — that is
 * the point. When Dave arrives he calls these same tools and gets the same
 * numbers a person sees on screen, so there is no second implementation to
 * drift.
 *
 * The GHG engine was chosen for the pilot because it is the one component
 * already built and verified end-to-end, so the pattern can be judged
 * without the result being in doubt.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON-schema-ish input contract, as advertised to the agent. */
  input: Record<string, string>;
}

export const GHG_TOOLS: ToolSpec[] = [
  {
    name: "compute_farm_year",
    description:
      "Compute VM0042 emissions for one farm-year against a parameter set. Returns each component (fuel CO2, direct/indirect N2O, N-fixing residue, residue burning) and the total, in tCO2e/ha and tCO2e.",
    input: { farmId: "string", scenario: "'BSL' | 'PR'", year: "number" },
  },
  {
    name: "explain_farm_year",
    description:
      "Return the full working for a farm-year: every VM0042 equation with its number, the expression as evaluated, and the result. Use this to defend a figure to a VVB.",
    input: { farmId: "string", scenario: "'BSL' | 'PR'", year: "number" },
  },
  {
    name: "compute_reduction",
    description:
      "Emission reduction for a farm: baseline (three-year pre-project average) minus the project year, per hectare and in total.",
    input: { farmId: "string", projectYear: "number" },
  },
  {
    name: "explain_parameters",
    description:
      "Explain which emission factors the active parameter set resolves to and why — the climate/N-trend switch on EF_N_direct, the climate/irrigation switch on Frac_LEACH, and whether soil N2O is counted here or taken from the model.",
    input: {},
  },
];

/* ── the tools themselves ──────────────────────────────────────────── */

export function computeFarmYear(
  activity: ActivityData[],
  p: GhgParameters,
  farmId: string,
  scenario: "BSL" | "PR",
  year?: number,
): { activity: ActivityData; result: EmissionResult } | null {
  const ad = activity.find(
    (a) => a.farmId === farmId && a.scenario === scenario && (year == null || a.year === year),
  );
  return ad ? { activity: ad, result: computeEmissions(ad, p) } : null;
}

export function explainFarmYear(
  activity: ActivityData[],
  p: GhgParameters,
  farmId: string,
  scenario: "BSL" | "PR",
  year?: number,
) {
  const ad = activity.find(
    (a) => a.farmId === farmId && a.scenario === scenario && (year == null || a.year === year),
  );
  return ad ? showWorking(ad, p) : null;
}

export function computeReduction(
  activity: ActivityData[],
  p: GhgParameters,
  farmId: string,
) {
  const bsl = activity.find((a) => a.farmId === farmId && a.scenario === "BSL");
  const pr = activity.find((a) => a.farmId === farmId && a.scenario === "PR");
  if (!bsl || !pr) return null;
  const b = computeEmissions(bsl, p);
  const j = computeEmissions(pr, p);
  return {
    baseline: b,
    project: j,
    reduction: emissionReduction(b, j, pr.areaHa),
    areaHa: pr.areaHa,
  };
}

export interface ParameterExplanation {
  key: string;
  resolved: string;
  why: string;
  ref: string;
}

export function explainParameters(p: GhgParameters): ParameterExplanation[] {
  const ef = efNDirect(p);
  const fl = fracLeach(p);

  const efWhy =
    p.climateZone === "dry"
      ? "Dry climate takes the flat dry factor regardless of trend."
      : p.nTrend === "decrease"
        ? "Wet climate with decreasing nitrogen takes the low end — claiming less while applying less is what makes the estimate conservative."
        : p.nTrend === "increase"
          ? "Wet climate with rising nitrogen takes the high end."
          : "Wet climate with flat nitrogen takes the midpoint.";

  const flWhy =
    p.climateZone === "wet"
      ? "Wet climates leach."
      : p.dryClimateIrrigated
        ? "Dry climate under non-drip irrigation still leaches."
        : "A dry, rain-fed system has no leaching pathway to account for.";

  const qa3 = p.soilN2OApproach === "QA3";

  return [
    {
      key: "EF_N_direct",
      resolved: String(ef),
      why: `${efWhy} Range: dry ${p.efNDirectDry}, low ${p.efNDirectLow}, mid ${p.efNDirectWet}, high ${p.efNDirectHigh}.`,
      ref: "VM0042 §8.3 · IPCC 2019",
    },
    {
      key: "Frac_LEACH",
      resolved: String(fl),
      why: flWhy,
      ref: "IPCC 2019",
    },
    {
      key: "Soil N₂O approach",
      resolved: p.soilN2OApproach,
      why: qa3
        ? "Soil N₂O is computed here from default factors and counted in the total."
        : "Soil N₂O comes from the model instead; it is shown here for reference but excluded from the total, so the same emission is never counted twice.",
      ref: "VM0042 §8.1",
    },
    {
      key: "GWP N₂O",
      resolved: String(p.gwpN2O),
      why: "AR5 100-year value, mandated by VM0042 v2.2.",
      ref: "VM0042 v2.2",
    },
  ];
}
