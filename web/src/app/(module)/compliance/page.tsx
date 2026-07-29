import { listFarms, listPlans, listProjects } from "@/lib/data";
import { DEMO_PLOTS, DEMO_SAMPLING_POINTS, DEMO_SOC, DEMO_SAMPLES } from "@/lib/data/fixtures";
import { evaluateCompliance, type ComplianceInputs } from "@/lib/compliance/evaluate";
import { ComplianceView } from "@/components/compliance/ComplianceView";

export const dynamic = "force-dynamic";

/**
 * Compliance (spec §7). Scored per farm-cycle and computed continuously, so
 * a broken rule shows the moment it breaks rather than at verification.
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

  // The cycle currently in the field or most recently approved.
  const cycle =
    plans.find((p) => p.farmId === active.farmId && p.status === "in_field") ??
    plans.find((p) => p.farmId === active.farmId) ??
    null;

  const plotIds = new Set(DEMO_PLOTS.filter((p) => p.farmId === active.farmId).map((p) => p.plotId));
  const points = DEMO_SAMPLING_POINTS.filter((sp) => sp.plotId && plotIds.has(sp.plotId));
  const sampleIds = new Set(
    DEMO_SAMPLES.filter((s) => points.some((p) => p.pointId === s.pointId)).map((s) => s.sampleId),
  );
  const soc = DEMO_SOC.filter((m) => sampleIds.has(m.sampleId));

  // One stratum per plot until texture stratification runs, matching the
  // planner and the database's behaviour when a plot has no strata rows.
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
    // No baseline control sites are seeded yet — QA2 requires three, so this
    // check fails, which is the correct reading of the current data.
    baselineControlSites: [],
    highCvStrata: 0,
  };

  const result = evaluateCompliance(inputs);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Compliance</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Every farm-cycle scored 0–100 against the VM0042 v2.2 hard checks and soft warnings. A
          hard failure caps the score below 100 however few warnings there are — the dashboard reads
          red the moment a rule breaks.
        </p>
      </div>
      <ComplianceView
        farms={farms.map((f) => ({ farmId: f.farmId, name: f.name }))}
        activeFarmId={active.farmId}
        cycleLabel={cycle ? `${cycle.cycleId} · cycle ${cycle.cycleNumber} · ${cycle.status.replace("_", " ")}` : "no cycle"}
        result={result}
      />
    </div>
  );
}
