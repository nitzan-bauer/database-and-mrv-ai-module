import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { buildFarmKml } from "../kml/buildFarmKml";

export interface KmlExport {
  farmId: string;
  farmName: string;
  plotCount: number;
  skipped: Array<{ plotId: string; plotName: string }>;
  kml: string;
}

/**
 * KML for every plot on a farm — Rebeka's own line: "prepare the KMZ/KML
 * for every farmer's plots and the Listing Representation form."
 *
 * This returns KML text, not a KMZ file. A KMZ is a KML zipped with its own
 * assets; a screen offering a download can zip one file trivially, so
 * there is no reason to duplicate a zip writer here for that alone.
 *
 * Geometry serialisation goes through PostGIS's own ST_AsKML rather than
 * being built by hand — that is exactly the kind of thing worth trusting
 * to the database that already validated the geometry, rather than
 * re-deriving coordinate ordering and precision in application code.
 *
 * A plot that fails ST_IsValid is left out rather than exported with a
 * geometry that cannot be trusted, and is named in `skipped` so the
 * omission is visible rather than a silent gap in the filing.
 */
export async function exportPlotsKml(
  ctx: ToolContext,
  input: { farmId: string },
): Promise<ToolResult<KmlExport>> {
  const guard = requireDbMode("exportPlotsKml");
  if (guard) return guard;

  const policy = await checkPolicy("export_plots_kml", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");

  const built = await buildFarmKml(query, input.farmId);
  if (!built.ok) return fail(`exportPlotsKml: ${built.error}`);
  const { farmName, plotCount, skipped, kml } = built.data;

  await audit(ctx, "export_plots_kml", { type: "farm", id: input.farmId }, {
    farmName,
    plotCount,
    skipped: skipped.map((s) => s.plotId),
  });

  return ok({ farmId: input.farmId, farmName, plotCount, skipped, kml });
}
