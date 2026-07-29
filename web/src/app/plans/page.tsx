import { getFarmsWithPlots, listPlans, listProjects } from "@/lib/data";
import { PlansView } from "@/components/plans/PlansView";
import { generatePlan, recommendation } from "@/lib/planner/generate";

export const dynamic = "force-dynamic";

/**
 * Screen 4 — Sampling Plan Generator (spec §6.4). All sampling plans for the
 * coming three years, grouped by project and filterable by farm; clicking a
 * plan opens its full parameters, the generator's self-checks, and Dave's
 * recommendation with reasoning.
 */
export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string; plan?: string }>;
}) {
  const { farm, plan: planParam } = await searchParams;
  const [project] = await listProjects();
  const [plans, farms] = await Promise.all([
    listPlans(project.projectId),
    getFarmsWithPlots(project.projectId),
  ]);

  // Regenerate each plan's allocation so the detail pane can show the
  // per-stratum reasoning and the hard checks the generator applied.
  const details = Object.fromEntries(
    plans.map((p) => {
      const farm = farms.find((f) => f.farmId === p.farmId);
      const plots = farm?.plots ?? [];
      const gen = generatePlan({
        plots,
        cycleNumber: p.cycleNumber,
        approach: p.approach,
        cvByStratum:
          p.cycleNumber === 1
            ? {}
            : Object.fromEntries(
                plots.map((pl, i) => [
                  `${pl.plotId}:A`,
                  p.cycleNumber === 2 ? (i === 0 ? 0.38 : 0.22) : 0.24,
                ]),
              ),
        mddTarget: p.mddTarget ?? 0.5,
        confidenceAlpha: p.confidenceAlpha ?? 0.9,
        power: p.power ?? 0.8,
      });
      return [p.cycleId, { plan: gen, advice: recommendation(gen) }];
    }),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Sampling plans</h1>
        <p className="mt-1 text-sm text-muted">
          {project.name} — all plans for the coming three years, grouped by project. Click a plan for
          its full parameters, the generator&apos;s hard checks, and Dave&apos;s recommendation.
        </p>
      </div>
      <PlansView
        plans={plans}
        farms={farms.map((f) => ({ farmId: f.farmId, name: f.name }))}
        details={details}
        initialFarm={farm && farms.some((f) => f.farmId === farm) ? farm : "all"}
        initialPlan={planParam && plans.some((p) => p.cycleId === planParam) ? planParam : null}
      />
    </div>
  );
}
