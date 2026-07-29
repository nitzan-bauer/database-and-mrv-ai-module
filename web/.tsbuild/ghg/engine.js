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
/** The seeded default-v1.0 set, from seeds/0001_reference_data.sql. */
export const DEFAULT_PARAMETERS = {
    version: "default-v1.0",
    climateZone: "wet",
    dryClimateIrrigated: false,
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
const round4 = (n) => Math.round(n * 1e4) / 1e4;
/** N2O-N to N2O mass conversion — mrv.n2o_n_to_n2o(). */
export const N2O_N_TO_N2O = 44 / 28;
/**
 * EF for direct N2O (VM0042 §8.3 conservativeness). A dry climate takes the
 * flat dry factor; a wet one takes the low end when nitrogen is decreasing
 * and the high end when it is rising, because claiming less while applying
 * less is what makes the estimate conservative.
 */
export function efNDirect(p) {
    if (p.climateZone === "dry")
        return p.efNDirectDry;
    if (p.nTrend === "decrease")
        return p.efNDirectLow;
    if (p.nTrend === "increase")
        return p.efNDirectHigh;
    return p.efNDirectWet;
}
/**
 * Leaching fraction. Wet climates leach; dry climates leach only under
 * non-drip irrigation. A dry, rain-fed system has no leaching pathway at all.
 */
export function fracLeach(p) {
    if (p.climateZone === "wet")
        return p.fracLeachWet;
    return p.dryClimateIrrigated ? p.fracLeachWet : 0;
}
/** Annualised N applied for one application, t N (eq 19/20). */
export function nApplied(f) {
    return round4((f.massT / f.intervalYears) * f.nContent);
}
/** One farm-year against one parameter set. */
export function computeEmissions(ad, p) {
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
        }
        else {
            fsn += n;
            gasf += n * p.fracGasf;
        }
    }
    // eq 18 — direct N2O, per ha
    const n2oDirect = round4(((fsn + fon) * efNDirect(p) * conv) / ad.areaHa);
    // eq 21 = eq 22 volatilisation + eq 23 leaching, per ha.
    // Both terms are absolute tonnes and divided by area only once, here.
    const n2oIndirect = round4(((gasf + gasm) * p.efNVolat * conv + (fsn + fon) * fracLeach(p) * p.efNLeach * conv) /
        ad.areaHa);
    // eq 24/25 — N2O from N-fixing crop residue, per ha
    const n2oNfix = round4((ad.nfixDryMatterT * ad.nfixNContent * efNDirect(p) * conv) / ad.areaHa);
    // eq 6/7 — CO2 from fuel, per ha
    const co2Fuel = round4((ad.dieselL * p.efCo2Diesel + ad.gasolineL * p.efCo2Gasoline) / ad.areaHa);
    // eq 32 — N2O from residue burning, per ha
    const n2oBurn = round4((p.gwpN2O * ad.residueBurntKg * p.cfCombustion * p.efCN2O) / 1e6 / ad.areaHa);
    // Soil N2O counts here only under QA3. Under QA1 it comes from the model
    // instead, and counting both would double-count the same emission.
    const soilN2OExcluded = p.soilN2OApproach !== "QA3";
    const totalPerHa = round4(co2Fuel + n2oBurn + (soilN2OExcluded ? 0 : n2oDirect + n2oIndirect + n2oNfix));
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
export function emissionReduction(baseline, project, areaHa) {
    const perHa = round4(baseline.totalPerHa - project.totalPerHa);
    return { perHa, total: round4(perHa * areaHa) };
}
export function showWorking(ad, p) {
    const conv = N2O_N_TO_N2O * p.gwpN2O;
    const r = computeEmissions(ad, p);
    const ef = efNDirect(p);
    const fl = fracLeach(p);
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
