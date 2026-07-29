/**
 * VM0042 v2.2 + ICVCM CCP compliance (spec §7).
 *
 * A mirror of `mrv.evaluate_compliance()` (migrations 0014 → 0018 → 0019):
 * same checks, same rule codes, same scoring. Compliance is not a report
 * produced at the end — it is computed continuously, so a rule broken today
 * turns the score red today rather than at verification.
 *
 * Scoring: every hard check passing gives 100, less 5 per soft warning.
 * Any hard failure caps the score below 100 no matter how few warnings
 * there are — that is the whole point of calling them hard.
 */

export type CheckResult = "pass" | "fail" | "warn" | "planned" | "not_applicable";

export interface ComplianceCheck {
  code: string;
  label: string;
  ref: string;
  isHard: boolean;
  result: CheckResult;
  detail: string;
  /** Where the rule is evaluated, so the reader knows what is authoritative. */
  enforcedIn: "database" | "module" | "planned";
}

export interface ComplianceScore {
  score: number;
  hardPassed: number;
  hardTotal: number;
  warnings: number;
  checks: ComplianceCheck[];
}

export interface ComplianceInputs {
  approach: "QA1_DNDC" | "QA1_DAYCENT" | "QA2" | "QA3";
  /** strata across the farm's plots */
  strata: Array<{ code: string; plotId: string; pointCount: number }>;
  /** SOC measurements in this cycle */
  measurements: Array<{
    sampleId: string;
    /** the sampling point the sample came from — ESM is judged per point */
    pointId: string;
    depthTopCm: number;
    method: string;
    methodDeviationNote?: string | null;
    labAccredited: boolean | null;
  }>;
  /** sampling events, for the same-season window */
  sameSeasonRequired: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  eventDates: string[];
  /** QA2 only */
  baselineControlSites: Array<{ distanceKm: number }>;
  /** per-stratum CV from a previous cycle, if measured */
  highCvStrata: number;
}

/** Spec v2.0 floor, matched by the database (migration 0018). */
export const MIN_COMPOSITES = 5;

export function evaluateCompliance(i: ComplianceInputs): ComplianceScore {
  const checks: ComplianceCheck[] = [];
  const hard = (
    code: string,
    label: string,
    ref: string,
    passed: boolean,
    detail: string,
    enforcedIn: ComplianceCheck["enforcedIn"] = "database",
  ) => {
    checks.push({
      code,
      label,
      ref,
      isHard: true,
      result: passed ? "pass" : "fail",
      detail,
      enforcedIn,
    });
  };

  /* 1 — stratified random sampling (§8.2.1.2) */
  hard(
    "STRATIFIED_RANDOM",
    "Stratified random sampling every cycle",
    "§8.2.1.2",
    i.strata.length > 0,
    `${i.strata.length} strata defined`,
  );

  /* 2 — ≥5 composites per stratum (§8.2.1.2) */
  const below = i.strata.filter((s) => s.pointCount < MIN_COMPOSITES);
  hard(
    "MIN_5_COMPOSITES",
    `≥ ${MIN_COMPOSITES} composite samples per stratum`,
    "§8.2.1.2",
    i.strata.length > 0 && below.length === 0,
    below.length
      ? `${below.length} strata below ${MIN_COMPOSITES}: ${below.map((s) => `${s.plotId}·${s.code}`).join(", ")}`
      : `all ${i.strata.length} strata at or above ${MIN_COMPOSITES}`,
  );

  /* 3 — ESM basis: two depth increments per sampling POINT (§8.2.1.6).
     0–15 and 15–30 cm are different soil in different bags, so they carry
     different sample IDs; the pair is what makes a point ESM-reportable. */
  const byPoint = new Map<string, Set<number>>();
  for (const m of i.measurements) {
    if (!byPoint.has(m.pointId)) byPoint.set(m.pointId, new Set());
    byPoint.get(m.pointId)!.add(m.depthTopCm);
  }
  const singleIncrement = [...byPoint.entries()].filter(([, d]) => d.size < 2);
  hard(
    "ESM_TWO_INCREMENTS",
    "ESM reporting — two depth increments per point",
    "§8.2.1.6",
    byPoint.size > 0 && singleIncrement.length === 0,
    byPoint.size === 0
      ? "no lab results yet"
      : singleIncrement.length
        ? `${singleIncrement.length} points with a single increment`
        : `${byPoint.size} points with 0–15 and 15–30 cm`,
  );

  /* 4 — same-season window (§8.2.1.1) */
  const outside =
    i.plannedStart && i.plannedEnd
      ? i.eventDates.filter((d) => d < i.plannedStart! || d > i.plannedEnd!)
      : [];
  hard(
    "SAME_SEASON_WINDOW",
    "Same-season sampling window respected",
    "§8.2.1.1",
    !i.sameSeasonRequired || outside.length === 0,
    !i.sameSeasonRequired
      ? "same-season not required for this cycle"
      : outside.length
        ? `${outside.length} events outside ${i.plannedStart} → ${i.plannedEnd}`
        : `all events inside ${i.plannedStart} → ${i.plannedEnd}`,
  );

  /* 5 — laboratory accreditation (§8.2.1.4) */
  const badLab = i.measurements.filter((m) => m.labAccredited !== true);
  hard(
    "LAB_ACCREDITED",
    "Lab ISO/IEC 17025, NAPT or GLOSOLAN",
    "§8.2.1.4",
    i.measurements.length > 0 && badLab.length === 0,
    i.measurements.length === 0
      ? "no lab results yet"
      : badLab.length
        ? `${badLab.length} measurements from an unaccredited or unknown laboratory`
        : "every measurement from an accredited laboratory",
  );

  /* 6 — dry combustion unless documented (§8.2.1.4) */
  const badMethod = i.measurements.filter(
    (m) => m.method !== "dry_combustion" && !(m.methodDeviationNote ?? "").trim(),
  );
  hard(
    "DRY_COMBUSTION",
    "Dry combustion (Dumas) unless documented",
    "§8.2.1.4",
    i.measurements.length > 0 && badMethod.length === 0,
    i.measurements.length === 0
      ? "no lab results yet"
      : badMethod.length
        ? `${badMethod.length} measurements on another method with no documented deviation`
        : "dry combustion throughout",
  );

  /* 7 — QA2 baseline control sites (§8.3) */
  if (i.approach === "QA2") {
    const far = i.baselineControlSites.filter((b) => b.distanceKm > 250);
    hard(
      "QA2_3_CONTROL_SITES",
      "QA2 — ≥3 control sites, each ≤250 km",
      "§8.3 · Table 7",
      i.baselineControlSites.length >= 3 && far.length === 0,
      `${i.baselineControlSites.length} control sites${far.length ? `, ${far.length} beyond 250 km` : ""}`,
    );
  }

  /* 8 — QA1 model validation, scheduled P3 (§8.6.1.3) */
  if (i.approach.startsWith("QA1")) {
    checks.push({
      code: "QA1_MVR_IME_SIGNED",
      label: "QA1 — model validated (VMD0053), MVR IME-signed",
      ref: "§8.6.1.3",
      isHard: true,
      result: "planned",
      detail: "scheduled P3 — reported as planned rather than silently passing",
      enforcedIn: "planned",
    });
  }

  /* soft — per-stratum CV > 30% (§8.2.1.3) */
  let warnings = 0;
  if (i.highCvStrata > 0) {
    warnings += 1;
    checks.push({
      code: "HIGH_CV",
      label: "Per-stratum CV above 30%",
      ref: "§8.2.1.3",
      isHard: false,
      result: "warn",
      detail: `${i.highCvStrata} strata with CV > 30% — consider +1 sample next cycle`,
      enforcedIn: "database",
    });
  }

  // "planned" checks are shown but not scored — counting them as failures
  // would understate a cycle that is compliant on everything built so far.
  const scored = checks.filter((c) => c.isHard && c.result !== "planned");
  const hardTotal = scored.length;
  const hardPassed = scored.filter((c) => c.result === "pass").length;

  const score =
    hardPassed === hardTotal
      ? Math.max(0, 100 - 5 * warnings)
      : Math.max(0, Math.floor((hardPassed * 100) / hardTotal) - 5 * warnings);

  return { score, hardPassed, hardTotal, warnings, checks };
}

/** The CCP condition that is a design rule rather than a computed check. */
export const CCP_CONDITION = {
  label: "ICVCM CCP — SOC not measured by Digital Soil Mapping",
  ref: "CCP condition · VT0014 excluded",
  detail:
    "To carry the CCP label, SOC must be measured by any permitted technique except DSM, which ICVCM did not assess. VT0014 is out of scope for CCP-labelled projects by design, not by check.",
};
