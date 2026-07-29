import { listFarms, listProjects } from "@/lib/data";
import { DEMO_ACTIVITY_DATA } from "@/lib/data/fixtures";
import { DEFAULT_PARAMETERS } from "@/lib/ghg/engine";
import { computeReduction, explainFarmYear, explainParameters, GHG_TOOLS } from "@/lib/ghg/skill";
import { GhgView } from "@/components/ghg/GhgView";

export const dynamic = "force-dynamic";

/**
 * GHG Calculator (spec AC#7) — emissions from fuel and nitrogen fertiliser
 * per farm-year, with the full working, plus the pilot of Dave's
 * GHG-Calculator skill over the same engine.
 */
export default async function GhgPage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string }>;
}) {
  const { farm } = await searchParams;
  const [project] = await listProjects();
  const farms = await listFarms(project.projectId);
  const active = farms.find((f) => f.farmId === farm) ?? farms[0];

  const p = DEFAULT_PARAMETERS;
  const reduction = computeReduction(DEMO_ACTIVITY_DATA, p, active.farmId);
  const workingBsl = explainFarmYear(DEMO_ACTIVITY_DATA, p, active.farmId, "BSL");
  const workingPr = explainFarmYear(DEMO_ACTIVITY_DATA, p, active.farmId, "PR");
  const activity = DEMO_ACTIVITY_DATA.filter((a) => a.farmId === active.farmId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">GHG Calculator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Emissions from fuel combustion and nitrogen-fertiliser use, per farm-year, under VM0042
          v2.2 Quantification Approach 3. Every figure is shown with the equation that produced it.
        </p>
      </div>
      <GhgView
        farms={farms.map((f) => ({ farmId: f.farmId, name: f.name, climateZone: f.climateZone }))}
        activeFarmId={active.farmId}
        parameters={p}
        parameterExplanations={explainParameters(p)}
        activity={activity}
        reduction={reduction}
        workingBsl={workingBsl}
        workingPr={workingPr}
        tools={GHG_TOOLS}
      />
    </div>
  );
}
