import { getFarmsWithPlots, listProjects, listSamplingPoints } from "@/lib/data";
import { MAPBOX_TOKEN } from "@/lib/env";
import { MapView } from "@/components/map/MapView";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/**
 * Screen 2 — Project Map (spec §6.2). The primary spatial workspace: WP plot
 * polygons, sampling points colour-coded by status, strata boundaries and BSL
 * sites as toggleable layers, and the Ask-Dave entry point (Tier 2).
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string }>;
}) {
  const { farm } = await searchParams;
  const [project] = await listProjects();
  // Demo farms (mrv.farms.is_demo, e.g. Elad Farm / Nitzan-Veg-Tech Farm)
  // are test fixtures, not real prospects — keep them off the map real
  // staff and prospects look at.
  const farms = (await getFarmsWithPlots(project.projectId)).filter((f) => !f.isDemo);
  // Sampling points are fetched independently of the farm list above, so
  // without this a demo farm's points would still float on the map with no
  // plot polygon under them.
  const visiblePlotIds = new Set(farms.flatMap((f) => f.plots.map((p) => p.plotId)));
  const points = (await listSamplingPoints(project.projectId)).filter(
    (sp) => sp.plotId == null || visiblePlotIds.has(sp.plotId),
  );

  if (!MAPBOX_TOKEN) {
    return (
      <Card className="p-8">
        <h1 className="text-lg font-semibold text-pine-700">Project Map</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-xs">
            NEXT_PUBLIC_MAPBOX_TOKEN
          </code>{" "}
          is not set. Add it to <code className="font-mono text-xs">web/.env.local</code> and restart
          the dev server — the map springs to life with the project&apos;s plots and sampling points.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pine-700">Project Map</h1>
          <p className="mt-1 text-sm text-muted">
            {project.name} · {project.methodology} ·{" "}
            {farms.reduce((s, f) => s + f.plotCount, 0)} plots ·{" "}
            {points.length} sampling points
          </p>
        </div>
      </div>
      <MapView
        token={MAPBOX_TOKEN}
        farms={farms}
        points={points}
        initialFarm={farm && farms.some((f) => f.farmId === farm) ? farm : "all"}
      />
    </div>
  );
}
