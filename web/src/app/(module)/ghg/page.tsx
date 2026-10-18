import Link from "next/link";
import { auth } from "@/auth";
import { getFarmsWithPlots, listActivityData, listFertilizers, listLeakage, listProjects } from "@/lib/data";
import type { Project } from "@/lib/data/types";
import { DATA_MODE } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import {
  averageBaselineRows,
  computeEmissions,
  computeLeakage841,
  emissionReduction,
  resolveParameters,
  showWorking,
  type ActivityData,
  type EmissionResult,
  type WorkingLine,
} from "@/lib/ghg/engine";
import { GhgWorkbook, type FarmSheet } from "@/components/ghg/GhgWorkbook";
import type { RecordedActivityData } from "@/lib/tools/recordActivityData";
import type { ToolResult } from "@/lib/tools/context";

export const dynamic = "force-dynamic";

/**
 * Record one farm/scenario/year of activity data as the signed-in person —
 * the same recordActivityData tool an agent would call, run here under a
 * human actor, which the policy gate always allows.
 */
async function recordActivityDataAction(input: {
  farmId: string;
  scenario: "BSL" | "PR" | "WP";
  year: number;
  areaHa: number;
  dieselL?: number;
  gasolineL?: number;
  residueBurntKg?: number;
  nfixDryMatterT?: number;
  nfixNContent?: number;
  fertilizers: Array<{ fertilizerName: string; massT: number; intervalYears?: number }>;
}): Promise<ToolResult<RecordedActivityData>> {
  "use server";
  const session = await auth().catch(() => null);
  const { recordActivityData } = await import("@/lib/tools/recordActivityData");
  return recordActivityData({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

function scenarioSlot(
  activity: ActivityData[],
  scenario: "BSL" | "PR",
  climateZone: "wet" | "dry" | null,
  irrigationMethod: import("@/lib/ghg/engine").IrrigationMethod | null,
): { activity: ActivityData; emissions: EmissionResult; working: WorkingLine[] } | null {
  if (!climateZone) return null;
  const row =
    scenario === "BSL"
      ? averageBaselineRows(activity.filter((a) => a.scenario === "BSL"))
      : activity.find((a) => a.scenario === "PR");
  if (!row) return null;
  const p = resolveParameters(climateZone);
  return { activity: row, emissions: computeEmissions(row, p, irrigationMethod), working: showWorking(row, p, irrigationMethod) };
}

/**
 * GHG Calculator — a real, per-project workbook: one screen set per
 * project, one row per real farm in every sheet-shaped tab (Baseline
 * Inputs, Project Inputs, Baseline Emissions, Project Emissions, Net
 * Reductions, Leakage, SOC Removals (QA1), Project Summary VVB), matching
 * the source Excel's own sheet names — Nitzan's own spec (2026-09-12):
 * "אני מצפה לראות שלכל פרויקט יש סט מסכים עם שמות החוות המשתתפות בכל
 * פרויקט גם אם אין להם נתונים" (every project shows a screen set naming
 * every participating farm, even with no data yet).
 *
 * Nothing here early-returns the whole page for one farm's missing
 * climate zone or activity data any more — that used to block every farm
 * behind whichever one the URL happened to select. A gap is now a
 * per-farm, per-row state (still never estimated), so the other farms in
 * the same project stay fully visible and computed.
 */
export default async function GhgPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: projectParam } = await searchParams;
  const projects = await listProjects();
  const project =
    projects.find((p) => p.projectId === projectParam) ??
    projects.find((p) => !p.isDemo) ??
    projects[0];
  const farms = await getFarmsWithPlots(project.projectId);
  const fertilizers = DATA_MODE === "db" ? await listFertilizers() : [];
  const manualLeakage = DATA_MODE === "db" ? await listLeakage(project.projectId) : [];

  const sheets: FarmSheet[] = await Promise.all(
    farms.map(async (f) => {
      const activity = await listActivityData(f.farmId);
      const bsl = scenarioSlot(activity, "BSL", f.climateZone, f.irrigationMethod);
      const pr = scenarioSlot(activity, "PR", f.climateZone, f.irrigationMethod);
      const reduction = bsl && pr ? emissionReduction(bsl.emissions, pr.emissions, pr.activity.areaHa) : null;
      const leakage841 = f.climateZone ? computeLeakage841(activity, f.farmId) : null;

      let bslSkipReason: string | null = null;
      let prSkipReason: string | null = null;
      if (!f.climateZone) {
        bslSkipReason = prSkipReason = "no climate zone recorded";
      } else if (f.climateZone === "dry" && !f.irrigationMethod) {
        bslSkipReason = prSkipReason = "dry zone, no irrigation method recorded";
      } else {
        if (!bsl) bslSkipReason = "no baseline (BSL) activity data recorded";
        if (!pr) prSkipReason = "no project-year (PR) activity data recorded";
      }

      const quantificationApproaches = [...new Set(f.plots.map((p) => p.quantificationApproach))];

      // The source workbook's Baseline/Project Inputs & Emissions sheets show
      // every recorded year as its own row (Farm_A 2022/2023/2024) — never
      // collapsed to the 3-year average, which only the Net Reductions /
      // Summary rollup uses. Computed the same way as bsl/pr above, just per
      // raw row instead of on the average.
      const canCompute = f.climateZone && !(f.climateZone === "dry" && !f.irrigationMethod);
      const p = canCompute ? resolveParameters(f.climateZone) : null;
      const toRow = (a: ActivityData) => ({ activity: a, emissions: computeEmissions(a, p!, f.irrigationMethod) });
      const bslRows = p ? activity.filter((a) => a.scenario === "BSL").map(toRow) : [];
      const prRows = p ? activity.filter((a) => a.scenario === "PR").map(toRow) : [];

      return {
        farmId: f.farmId,
        name: f.name,
        climateZone: f.climateZone,
        irrigationMethod: f.irrigationMethod,
        totalAreaHa: f.totalAreaHa,
        quantificationApproaches,
        bsl,
        bslSkipReason,
        bslRows,
        pr,
        prSkipReason,
        prRows,
        reduction,
        leakage841,
      };
    }),
  );

  return (
    <div className="space-y-5">
      <Header />
      <ProjectSwitcher projects={projects} activeProjectId={project.projectId} />

      {sheets.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm font-semibold text-pine-700">{project.name} has no farms recorded yet.</p>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Nothing is invented in their place — add the project&apos;s real farms before quantifying it.
          </p>
        </Card>
      ) : (
        <GhgWorkbook
          project={project}
          sheets={sheets}
          manualLeakage={manualLeakage}
          fertilizers={fertilizers}
          recordActivityDataAction={DATA_MODE === "db" ? recordActivityDataAction : undefined}
        />
      )}
    </div>
  );
}

/** The page title + standing description — identical across every state this page can render. */
function Header() {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">GHG Calculator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Emissions from fuel combustion and nitrogen-fertiliser use, per farm-year, under VM0042
          v2.2 Quantification Approach 3. Every figure is shown with the equation that produced it.
        </p>
      </div>
      <Link
        href="/ghg/reference"
        className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-pine-700 hover:bg-pine-50"
      >
        Reference Hub ↗
      </Link>
    </div>
  );
}

/**
 * Which project this calculator is quantifying — real projects first, each
 * tagged plainly as real or demo. Before this, the page picked whichever
 * project sorted first alphabetically and had no way to see or change it.
 */
function ProjectSwitcher({
  projects,
  activeProjectId,
}: {
  projects: Project[];
  activeProjectId: string;
}) {
  if (projects.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
        Project
      </span>
      {projects.map((p) => (
        <Link
          key={p.projectId}
          href={`/ghg?project=${p.projectId}`}
          className={
            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
            (p.projectId === activeProjectId
              ? "bg-pine-600 text-white"
              : "border border-line bg-white text-pine-700 hover:bg-pine-50")
          }
        >
          {p.name}
          {p.isDemo && <span className="ml-1.5 opacity-70">DEMO</span>}
        </Link>
      ))}
    </div>
  );
}
