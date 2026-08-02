import { auth } from "@/auth";
import {
  getLatestCompliance,
  listAdditionalityAssessments,
  listBaselineSites,
  listFarms,
  listPlans,
  listPlots,
  listProjects,
} from "@/lib/data";
import { DEMO_PLOTS, DEMO_SAMPLING_POINTS, DEMO_SOC, DEMO_SAMPLES } from "@/lib/data/fixtures";
import { DATA_MODE } from "@/lib/env";
import {
  evaluateCompliance,
  type ComplianceInputs,
  type ComplianceScore,
} from "@/lib/compliance/evaluate";
import { ComplianceView } from "@/components/compliance/ComplianceView";
import { BaselineSiteForm } from "@/components/compliance/BaselineSiteForm";
import { AdditionalityForm } from "@/components/compliance/AdditionalityForm";
import { KmzDownloadButton } from "@/components/compliance/KmzDownloadButton";
import type { RecordedBaselineSite, SimilarityCriterion } from "@/lib/tools/recordBaselineSite";
import type { Barrier, RecordedAdditionality } from "@/lib/tools/recordAdditionalityAssessment";
import type { KmzExport } from "@/lib/tools/exportPlotsKmz";
import type { ToolResult } from "@/lib/tools/context";

export const dynamic = "force-dynamic";

/**
 * Record one baseline control site as the signed-in person — the same
 * recordBaselineSite tool an agent would call, run here under a human
 * actor, which the policy gate always allows.
 */
async function recordBaselineSiteAction(input: {
  farmId: string;
  geometry: string;
  linkedPlotId?: string | null;
  criteria: SimilarityCriterion[];
}): Promise<ToolResult<RecordedBaselineSite>> {
  "use server";
  const session = await auth().catch(() => null);
  const { recordBaselineSite } = await import("@/lib/tools/recordBaselineSite");
  return recordBaselineSite({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

/** Record a VM0042 §7 additionality assessment as the signed-in person. */
async function recordAdditionalityAssessmentAction(input: {
  projectId: string;
  regulatorySurplusMet: boolean;
  regulatorySurplusNote: string;
  barriers: Barrier[];
  commonPracticeRegion: string;
  commonPracticeAdoptionPct: number | null;
  step4cDemonstrated?: boolean;
  step4cNote?: string;
}): Promise<ToolResult<RecordedAdditionality>> {
  "use server";
  const session = await auth().catch(() => null);
  const { recordAdditionalityAssessment } = await import("@/lib/tools/recordAdditionalityAssessment");
  return recordAdditionalityAssessment({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

/** Export a farm's plot boundaries as a KMZ, confirmed by the signed-in person. */
async function exportPlotsKmzAction(input: { farmId: string }): Promise<ToolResult<KmzExport>> {
  "use server";
  const session = await auth().catch(() => null);
  const { exportPlotsKmz } = await import("@/lib/tools/exportPlotsKmz");
  return exportPlotsKmz({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

/** How each rule is labelled when the row comes from the database. */
const RULE_LABELS: Record<string, { label: string; ref: string }> = {
  STRATIFIED_RANDOM: { label: "Stratified random sampling", ref: "§8.2.1.2" },
  MIN_5_COMPOSITES: { label: "≥ 5 composites per stratum", ref: "§8.2.1.2" },
  ESM_TWO_INCREMENTS: { label: "Two depth increments (ESM)", ref: "§8.2.1.6" },
  SAME_SEASON_WINDOW: { label: "Sampling inside the planned window", ref: "§8.2.1.3" },
  LAB_ACCREDITED: { label: "Accredited laboratory", ref: "§8.2.1.4" },
  DRY_COMBUSTION: { label: "Dry combustion (or documented deviation)", ref: "§8.2.1.4" },
  QA2_3_CONTROL_SITES: { label: "≥ 3 baseline control sites (QA2)", ref: "Table 7" },
  HIGH_CV_WARNING: { label: "Stratum CV under 30%", ref: "§8.2.1.3" },
};

/**
 * Compliance (spec §7). Scored per farm-cycle and computed continuously, so
 * a broken rule shows the moment it breaks rather than at verification.
 *
 * In db mode the score comes from mrv.evaluate_compliance()'s own tables —
 * the database is the authority, its rows are what a VVB is shown, and
 * recomputing the rules client-side would drift the day one rule changes in
 * only one place. The TypeScript mirror still runs in fixtures mode, where
 * there is no database to ask.
 */
export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string }>;
}) {
  const { farm } = await searchParams;
  const [project] = await listProjects();
  const farms = await listFarms(project.projectId);
  const plans = await listPlans(project.projectId);
  const active = farms.find((f) => f.farmId === farm) ?? farms[0];

  const cycle =
    plans.find((p) => p.farmId === active.farmId && p.status === "in_field") ??
    plans.find((p) => p.farmId === active.farmId) ??
    null;

  let result: ComplianceScore | null = null;
  let cycleLabel = "no cycle";
  let source: "database" | "module" = "module";

  if (DATA_MODE === "db") {
    const db = await getLatestCompliance(active.farmId);
    if (db) {
      source = "database";
      cycleLabel = `cycle ${db.cycleNumber} · evaluated ${new Date(db.evaluatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;
      result = {
        score: db.score,
        hardPassed: db.hardPassed,
        hardTotal: db.hardTotal,
        warnings: db.warnings,
        checks: db.checks.map((c) => ({
          code: c.ruleCode,
          label: RULE_LABELS[c.ruleCode]?.label ?? c.ruleCode,
          ref: c.vm0042Ref ?? RULE_LABELS[c.ruleCode]?.ref ?? "",
          isHard: c.isHard,
          result: c.result,
          detail: c.detail ?? "",
          enforcedIn: "database",
        })),
      };
    }
  } else {
    // Fixtures: the TypeScript mirror over the demo data, as before.
    const plotIds = new Set(
      DEMO_PLOTS.filter((p) => p.farmId === active.farmId).map((p) => p.plotId),
    );
    const points = DEMO_SAMPLING_POINTS.filter((sp) => sp.plotId && plotIds.has(sp.plotId));
    const sampleIds = new Set(
      DEMO_SAMPLES.filter((s) => points.some((p) => p.pointId === s.pointId)).map(
        (s) => s.sampleId,
      ),
    );
    const soc = DEMO_SOC.filter((m) => sampleIds.has(m.sampleId));
    const strata = [...plotIds].map((plotId) => ({
      code: "A",
      plotId,
      pointCount: points.filter((p) => p.plotId === plotId).length,
    }));

    const inputs: ComplianceInputs = {
      approach: "QA2",
      strata,
      measurements: soc.map((m) => ({
        sampleId: m.sampleId,
        pointId: DEMO_SAMPLES.find((s) => s.sampleId === m.sampleId)?.pointId ?? m.sampleId,
        depthTopCm: m.depthTopCm,
        method: m.method,
        methodDeviationNote: null,
        labAccredited: true, // CropNut Kenya — ISO 17025 + GLOSOLAN
      })),
      sameSeasonRequired: cycle?.sameSeason ?? true,
      plannedStart: cycle?.plannedStart ?? null,
      plannedEnd: cycle?.plannedEnd ?? null,
      eventDates: DEMO_SAMPLES.filter((s) => sampleIds.has(s.sampleId))
        .map((s) => s.samplingDate)
        .filter((d): d is string => !!d),
      baselineControlSites: [],
      highCvStrata: 0,
    };
    result = evaluateCompliance(inputs);
    cycleLabel = cycle
      ? `${cycle.cycleId} · cycle ${cycle.cycleNumber} · ${cycle.status.replace("_", " ")}`
      : "no cycle";
  }

  const baselineSites = DATA_MODE === "db" ? await listBaselineSites(active.farmId) : [];
  const plots = DATA_MODE === "db" ? await listPlots(active.farmId) : [];
  const additionality = DATA_MODE === "db" ? await listAdditionalityAssessments(project.projectId) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Compliance</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Every farm-cycle scored 0–100 against the VM0042 v2.2 hard checks and soft warnings. A
          hard failure caps the score below 100 however few warnings there are — the dashboard reads
          red the moment a rule breaks.
        </p>
        {source === "database" && (
          <p className="mt-1 font-mono text-[11px] text-faint">
            source: mrv.evaluate_compliance() on the live database
          </p>
        )}
      </div>

      {result ? (
        <ComplianceView
          farms={farms.map((f) => ({ farmId: f.farmId, name: f.name }))}
          activeFarmId={active.farmId}
          cycleLabel={cycleLabel}
          result={result}
        />
      ) : (
        // Never evaluated: say so, rather than dressing a fixture score up
        // as a real one. An honest blank is better evidence than a fake 85.
        <div className="rounded-xl border border-line bg-white p-6">
          <p className="text-sm font-semibold text-pine-700">
            {active.name} has not been evaluated yet.
          </p>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            No compliance run exists for this farm in the database. The score appears here the
            first time a sampling cycle is evaluated — create a plan, capture the points, ingest
            the lab results, and the engine scores it.
          </p>
        </div>
      )}

      {DATA_MODE === "db" && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-bold text-pine-700">
              Baseline control sites — {active.name}
            </h2>
            <KmzDownloadButton farmId={active.farmId} action={exportPlotsKmzAction} />
          </div>
          <p className="mb-3 max-w-3xl text-[13px] text-muted">
            QA2_3_CONTROL_SITES needs at least 3, each within 250 km. Area and distance are computed
            from the boundary you enter, not typed in.
          </p>
          {baselineSites.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-line bg-white">
              {baselineSites.map((s, i) => (
                <div
                  key={s.bslId}
                  className={"flex items-baseline gap-3 px-4 py-2.5 " + (i > 0 ? "border-t border-line" : "")}
                >
                  <span className="w-24 shrink-0 font-mono text-[12px] font-semibold text-pine-700">
                    {s.bslId}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-[12px] text-pine-700">
                    {s.areaHa.toFixed(2)} ha
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-[12px] text-pine-700">
                    {s.distanceKm.toFixed(1)} km
                  </span>
                  <span className="text-[11.5px] text-faint">
                    {s.criteria.filter((c) => c.met).length}/{s.criteria.length} criteria met
                  </span>
                </div>
              ))}
            </div>
          )}
          <BaselineSiteForm
            farmId={active.farmId}
            plots={plots.map((p) => ({ plotId: p.plotId, name: p.name }))}
            action={recordBaselineSiteAction}
          />
        </section>
      )}

      {DATA_MODE === "db" && (
        <section>
          <h2 className="mb-1 text-base font-bold text-pine-700">
            Additionality — {project.name}
          </h2>
          <p className="mb-3 max-w-3xl text-[13px] text-muted">
            VM0042 v2.2 §7&apos;s three steps: regulatory surplus, a barrier analysis, and the common-
            practice test (below 20% adoption passes on its own; at or above, Step 4c must be shown).
            This is per-project, not per-farm.
          </p>
          {additionality.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-line bg-white">
              {additionality.map((a, i) => (
                <div
                  key={a.assessmentId}
                  className={"px-4 py-2.5 " + (i > 0 ? "border-t border-line" : "")}
                >
                  <div className="flex items-baseline gap-3">
                    <span
                      className={
                        "w-32 shrink-0 text-[12px] font-bold " +
                        (a.overallMet ? "text-sage-700" : "text-earth-600")
                      }
                    >
                      {a.overallMet ? "demonstrated" : "not demonstrated"}
                    </span>
                    <span className="text-[11.5px] text-faint">
                      regulatory surplus {a.regulatorySurplusMet ? "met" : "not met"} ·{" "}
                      {a.barriers.length} barrier(s) · common practice{" "}
                      {a.commonPracticeMet ? "passes" : "does not pass"} ({a.commonPracticeRegion}
                      {a.commonPracticeAdoptionPct != null ? `, ${a.commonPracticeAdoptionPct}%` : ""}) ·{" "}
                      {new Date(a.assessedAt).toLocaleDateString("en-GB")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AdditionalityForm projectId={project.projectId} action={recordAdditionalityAssessmentAction} />
        </section>
      )}
    </div>
  );
}
