/**
 * The VM0042 emission equations (spec AC#7).
 *
 * This is a faithful mirror of `mrv.compute_emissions()` (migration 0013):
 * same equations, same parameter helpers, and the same rounding — each
 * component is rounded to 4 dp and the total is the sum of the rounded
 * components, not a rounded sum. That matters: the module must not report a
 * different figure from the database over a half-unit in the fourth decimal.
 *
 * In db mode the database is the authority and this is used to show the
 * working; in fixtures mode it is the engine. Dave's GHG-Calculator skill
 * (Tier 2) calls the same functions, so agent and human see one arithmetic.
 */

export type ClimateZone = "wet" | "dry";

/**
 * How water reaches the crop — mrv.irrigation_method.
 *
 * Recorded per farm, never inferred from the country or the climate zone.
 * Drip runs at scale across Kenya and East Africa as much as it does in
 * Israel, and water scarcity moves more farms onto it every season; under
 * VM0042 that switch is an eligible project activity in its own right, so
 * the module has to be able to record it rather than assume it away.
 */
export type IrrigationMethod = "flood" | "furrow" | "sprinkler" | "drip" | "rainfed";

/** The dry-zone methods that put water below the root zone. */
const LEACHING_METHODS: ReadonlySet<IrrigationMethod> = new Set<IrrigationMethod>([
  "flood",
  "furrow",
  "sprinkler",
]);
export type NTrend = "increase" | "decrease" | "flat";
export type SoilN2OApproach = "QA1_DNDC" | "QA1_DAYCENT" | "QA2" | "QA3";
export type FertilizerClass = "synthetic" | "organic";

/** mrv.ghg_parameters — the workbook's "Fixed Parameters" sheet. */
export interface GhgParameters {
  version: string;
  climateZone: ClimateZone;
  nTrend: NTrend;
  soilN2OApproach: SoilN2OApproach;
  efCo2Diesel: number;
  efCo2Gasoline: number;
  gwpN2O: number;
  efNDirectWet: number;
  efNDirectDry: number;
  efNDirectLow: number;
  efNDirectHigh: number;
  fracGasf: number;
  fracGasm: number;
  efNVolat: number;
  fracLeachWet: number;
  efNLeach: number;
  cfCombustion: number;
  efCN2O: number;
}

/** The seeded default-v1.0 set, from seeds/0001_reference_data.sql. */
export const DEFAULT_PARAMETERS: GhgParameters = {
  version: "default-v1.0",
  climateZone: "wet",
  nTrend: "decrease",
  soilN2OApproach: "QA3",
  efCo2Diesel: 0.002886,
  efCo2Gasoline: 0.00281,
  gwpN2O: 265,
  efNDirectWet: 0.016,
  efNDirectDry: 0.005,
  efNDirectLow: 0.013,
  efNDirectHigh: 0.019,
  fracGasf: 0.11,
  fracGasm: 0.21,
  efNVolat: 0.014,
  fracLeachWet: 0.24,
  efNLeach: 0.011,
  cfCombustion: 0.5,
  efCN2O: 0.07,
};

/**
 * The seeded dry-v1.0 set (migration 0020). Identical to default-v1.0 apart
 * from the climate zone, which is the whole point: EF_N_direct is picked
 * from it, and on its own that moves the claimed reduction by a factor of
 * 2.6. Frac_LEACH also depends on the zone, but the other half of that
 * decision — the irrigation method — lives on the farm, not here.
 */
export const DRY_PARAMETERS: GhgParameters = {
  ...DEFAULT_PARAMETERS,
  version: "dry-v1.0",
  climateZone: "dry",
};

/**
 * The parameter set a farm must be costed against — the mirror of
 * `mrv.resolve_parameter_set()`.
 *
 * It throws on an unknown zone rather than falling back to the wet set.
 * Defaulting here would mean guessing the credit volume: applying wet
 * factors to a dry farm overstates the claimed reduction by ~160%, and
 * over-crediting is the direction a VVB rejects.
 */
export function resolveParameters(climateZone: ClimateZone | null | undefined): GhgParameters {
  if (climateZone === "wet") return DEFAULT_PARAMETERS;
  if (climateZone === "dry") return DRY_PARAMETERS;
  throw new Error(
    "resolveParameters: the farm has no climate_zone. Set it before computing emissions — " +
      "wet and dry differ by 2.6x on EF_N_direct.",
  );
}

export interface FertilizerApplication {
  fertilizerName: string;
  massT: number;
  nContent: number;
  class: FertilizerClass;
  /** Organic mass is spread over its application interval (eq 20). */
  intervalYears: number;
}

export interface ActivityData {
  farmId: string;
  /** BSL = the three-year pre-project average; PR = a project year. */
  scenario: "BSL" | "PR";
  year: number;
  areaHa: number;
  dieselL: number;
  gasolineL: number;
  residueBurntKg: number;
  nfixDryMatterT: number;
  nfixNContent: number;
  fertilizers: FertilizerApplication[];
}

export interface EmissionResult {
  fsnTN: number;
  fonTN: number;
  n2oDirect: number;
  n2oIndirect: number;
  n2oNfix: number;
  co2Fuel: number;
  n2oBurn: number;
  /** tCO2e/ha */
  totalPerHa: number;
  /** tCO2e */
  total: number;
  /** true when soil N2O was excluded because the approach is QA1 */
  soilN2OExcluded: boolean;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** N2O-N to N2O mass conversion — mrv.n2o_n_to_n2o(). */
export const N2O_N_TO_N2O = 44 / 28;

/**
 * EF for direct N2O (VM0042 §8.3 conservativeness). A dry climate takes the
 * flat dry factor; a wet one takes the low end when nitrogen is decreasing
 * and the high end when it is rising, because claiming less while applying
 * less is what makes the estimate conservative.
 */
export function efNDirect(p: GhgParameters): number {
  if (p.climateZone === "dry") return p.efNDirectDry;
  if (p.nTrend === "decrease") return p.efNDirectLow;
  if (p.nTrend === "increase") return p.efNDirectHigh;
  return p.efNDirectWet;
}

/**
 * Leaching fraction — mrv.frac_leach(parameters, irrigation_method).
 *
 * Frac_LEACH is about water draining below the root zone, and there are two
 * separate ways to get it:
 *
 *   wet zone — rainfall exceeds evapotranspiration, so the surplus comes
 *              from the sky. The irrigation method cannot take that away,
 *              and drip does not zero it. This attaches to where the water
 *              is, not to which country the farm is in.
 *
 *   dry zone — rain alone leaves no surplus, so only irrigation can create
 *              one. Flood and furrow do; sprinkler wets the whole profile
 *              and is treated as doing so; drip delivers to the root zone
 *              and does not; rain-fed has no irrigation at all.
 *
 * So a dry-zone farm on drip gets zero whether it sits in Israel or in
 * Kenya — the answer comes from the farm's own zone and method.
 */
export function fracLeach(p: GhgParameters, method: IrrigationMethod | null | undefined): number {
  if (p.climateZone === "wet") return p.fracLeachWet;
  if (!method) {
    throw new Error(
      "fracLeach: the farm has no irrigation_method. In a dry zone it decides Frac_LEACH " +
        "(0 on drip or rain-fed, the full fraction under flood), so it cannot be assumed.",
    );
  }
  return LEACHING_METHODS.has(method) ? p.fracLeachWet : 0;
}

/** Annualised N applied for one application, t N (eq 19/20). */
export function nApplied(f: FertilizerApplication): number {
  return round4((f.massT / f.intervalYears) * f.nContent);
}

/** One farm-year against one parameter set. */
export function computeEmissions(
  ad: ActivityData,
  p: GhgParameters,
  method: IrrigationMethod | null | undefined,
): EmissionResult {
  const conv = N2O_N_TO_N2O * p.gwpN2O;

  let fsn = 0;
  let fon = 0;
  let gasf = 0;
  let gasm = 0;
  for (const f of ad.fertilizers) {
    const n = nApplied(f);
    if (f.class === "organic") {
      fon += n;
      gasm += n * p.fracGasm;
    } else {
      fsn += n;
      gasf += n * p.fracGasf;
    }
  }

  // eq 18 — direct N2O, per ha
  const n2oDirect = round4(((fsn + fon) * efNDirect(p) * conv) / ad.areaHa);

  // eq 21 = eq 22 volatilisation + eq 23 leaching, per ha.
  // Both terms are absolute tonnes and divided by area only once, here.
  const n2oIndirect = round4(
    ((gasf + gasm) * p.efNVolat * conv + (fsn + fon) * fracLeach(p, method) * p.efNLeach * conv) /
      ad.areaHa,
  );

  // eq 24/25 — N2O from N-fixing crop residue, per ha
  const n2oNfix = round4(
    (ad.nfixDryMatterT * ad.nfixNContent * efNDirect(p) * conv) / ad.areaHa,
  );

  // eq 6/7 — CO2 from fuel, per ha
  const co2Fuel = round4(
    (ad.dieselL * p.efCo2Diesel + ad.gasolineL * p.efCo2Gasoline) / ad.areaHa,
  );

  // eq 32 — N2O from residue burning, per ha
  const n2oBurn = round4(
    (p.gwpN2O * ad.residueBurntKg * p.cfCombustion * p.efCN2O) / 1e6 / ad.areaHa,
  );

  // Soil N2O counts here only under QA3. Under QA1 it comes from the model
  // instead, and counting both would double-count the same emission.
  const soilN2OExcluded = p.soilN2OApproach !== "QA3";
  const totalPerHa = round4(
    co2Fuel + n2oBurn + (soilN2OExcluded ? 0 : n2oDirect + n2oIndirect + n2oNfix),
  );

  return {
    fsnTN: round4(fsn),
    fonTN: round4(fon),
    n2oDirect,
    n2oIndirect,
    n2oNfix,
    co2Fuel,
    n2oBurn,
    totalPerHa,
    total: round4(totalPerHa * ad.areaHa),
    soilN2OExcluded,
  };
}

/**
 * Emission reductions: baseline minus project, per hectare, applied to the
 * project area. The baseline is the average of the three years preceding
 * project start, which is why it arrives as a single BSL row.
 */
export function emissionReduction(
  baseline: EmissionResult,
  project: EmissionResult,
  areaHa: number,
): { perHa: number; total: number } {
  const perHa = round4(baseline.totalPerHa - project.totalPerHa);
  return { perHa, total: round4(perHa * areaHa) };
}

/** Every line of the calculation, for the working shown on screen. */
export interface WorkingLine {
  eq: string;
  label: string;
  expression: string;
  value: number;
  unit: string;
}

export function showWorking(
  ad: ActivityData,
  p: GhgParameters,
  method: IrrigationMethod | null | undefined,
): WorkingLine[] {
  const conv = N2O_N_TO_N2O * p.gwpN2O;
  const r = computeEmissions(ad, p, method);
  const ef = efNDirect(p);
  const fl = fracLeach(p, method);
  const gasf = ad.fertilizers
    .filter((f) => f.class !== "organic")
    .reduce((s, f) => s + nApplied(f) * p.fracGasf, 0);
  const gasm = ad.fertilizers
    .filter((f) => f.class === "organic")
    .reduce((s, f) => s + nApplied(f) * p.fracGasm, 0);

  return [
    {
      eq: "19",
      label: "Synthetic N applied (FSN)",
      expression: "Σ (mass × N content)",
      value: r.fsnTN,
      unit: "t N",
    },
    {
      eq: "20",
      label: "Organic N applied (FON)",
      expression: "Σ (mass ÷ interval × N content)",
      value: r.fonTN,
      unit: "t N",
    },
    {
      eq: "18",
      label: "N₂O direct",
      expression: `(${r.fsnTN} + ${r.fonTN}) × ${ef} × 44/28 × ${p.gwpN2O} ÷ ${ad.areaHa}`,
      value: r.n2oDirect,
      unit: "tCO₂e/ha",
    },
    {
      eq: "22",
      label: "N₂O volatilisation",
      expression: `(${round4(gasf)} + ${round4(gasm)}) × ${p.efNVolat} × ${round4(conv)}`,
      value: round4((gasf + gasm) * p.efNVolat * conv),
      unit: "tCO₂e",
    },
    {
      eq: "23",
      label: "N₂O leaching",
      expression: `(${r.fsnTN} + ${r.fonTN}) × ${fl} × ${p.efNLeach} × ${round4(conv)}`,
      value: round4((r.fsnTN + r.fonTN) * fl * p.efNLeach * conv),
      unit: "tCO₂e",
    },
    {
      eq: "21",
      label: "N₂O indirect (per ha)",
      expression: "(volatilisation + leaching) ÷ area",
      value: r.n2oIndirect,
      unit: "tCO₂e/ha",
    },
    {
      eq: "24",
      label: "N₂O from N-fixing residue",
      expression: `${ad.nfixDryMatterT} × ${ad.nfixNContent} × ${ef} × ${round4(conv)} ÷ ${ad.areaHa}`,
      value: r.n2oNfix,
      unit: "tCO₂e/ha",
    },
    {
      eq: "6/7",
      label: "CO₂ from fuel",
      expression: `(${ad.dieselL} × ${p.efCo2Diesel} + ${ad.gasolineL} × ${p.efCo2Gasoline}) ÷ ${ad.areaHa}`,
      value: r.co2Fuel,
      unit: "tCO₂e/ha",
    },
    {
      eq: "32",
      label: "N₂O from residue burning",
      expression: `${p.gwpN2O} × ${ad.residueBurntKg} × ${p.cfCombustion} × ${p.efCN2O} ÷ 10⁶ ÷ ${ad.areaHa}`,
      value: r.n2oBurn,
      unit: "tCO₂e/ha",
    },
    {
      eq: "17",
      label: r.soilN2OExcluded
        ? "Total (soil N₂O from the model, not counted here)"
        : "Total",
      expression: r.soilN2OExcluded
        ? "fuel + burning — QA1 takes soil N₂O from the model"
        : "fuel + burning + direct + indirect + N-fixing",
      value: r.totalPerHa,
      unit: "tCO₂e/ha",
    },
  ];
}
