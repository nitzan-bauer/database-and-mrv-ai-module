import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface KmlExport {
  farmId: string;
  farmName: string;
  plotCount: number;
  skipped: Array<{ plotId: string; plotName: string }>;
  kml: string;
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

  const farms = await query<{ name: string }>(`SELECT name FROM mrv.farms WHERE farm_id = $1`, [
    input.farmId,
  ]);
  if (!farms.length) return fail("exportPlotsKml: no such farm.");
  const farmName = farms[0].name;

  const all = await query<{ plot_id: string; name: string; is_valid: boolean; kml: string | null }>(
    `SELECT plot_id, name, ST_IsValid(geom) AS is_valid,
            CASE WHEN ST_IsValid(geom) THEN ST_AsKML(geom) END AS kml
       FROM mrv.plots WHERE farm_id = $1 ORDER BY plot_id`,
    [input.farmId],
  );
  if (!all.length) return fail("exportPlotsKml: this farm has no plots.");

  const exportable = all.filter((p) => p.is_valid && p.kml);
  const skipped = all.filter((p) => !p.is_valid).map((p) => ({ plotId: p.plot_id, plotName: p.name }));
  if (!exportable.length) {
    return fail(
      "exportPlotsKml: none of this farm's plots have a valid geometry to export. " +
        "Run plot QA/QC and fix the boundaries first.",
    );
  }

  const placemarks = exportable
    .map(
      (p) =>
        `  <Placemark><name>${escapeXml(p.name)}</name>` +
        `<ExtendedData><Data name="plot_id"><value>${escapeXml(p.plot_id)}</value></Data></ExtendedData>` +
        `${p.kml}</Placemark>`,
    )
    .join("\n");

  const kml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(farmName)}</name>\n` +
    `${placemarks}\n` +
    `</Document></kml>\n`;

  await audit(ctx, "export_plots_kml", { type: "farm", id: input.farmId }, {
    farmName,
    plotCount: exportable.length,
    skipped: skipped.map((s) => s.plotId),
  });

  return ok({ farmId: input.farmId, farmName, plotCount: exportable.length, skipped, kml });
}
