import "server-only";
import type { query as queryFn } from "../db";

export interface FarmKml {
  farmName: string;
  plotCount: number;
  skipped: Array<{ plotId: string; plotName: string }>;
  kml: string;
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Shared by exportPlotsKml (returns the KML text as-is) and exportPlotsKmz
 * (zips the same text) — one query and one escaping/serialisation pass,
 * not two copies that could drift on which plots get skipped or how a
 * name gets escaped.
 */
export async function buildFarmKml(
  query: typeof queryFn,
  farmId: string,
): Promise<{ ok: true; data: FarmKml } | { ok: false; error: string }> {
  const farms = await query<{ name: string }>(`SELECT name FROM mrv.farms WHERE farm_id = $1`, [farmId]);
  if (!farms.length) return { ok: false, error: "no such farm." };
  const farmName = farms[0].name;

  const all = await query<{ plot_id: string; name: string; is_valid: boolean; kml: string | null }>(
    `SELECT plot_id, name, ST_IsValid(geom) AS is_valid,
            CASE WHEN ST_IsValid(geom) THEN ST_AsKML(geom) END AS kml
       FROM mrv.plots WHERE farm_id = $1 ORDER BY plot_id`,
    [farmId],
  );
  if (!all.length) return { ok: false, error: "this farm has no plots." };

  const exportable = all.filter((p) => p.is_valid && p.kml);
  const skipped = all.filter((p) => !p.is_valid).map((p) => ({ plotId: p.plot_id, plotName: p.name }));
  if (!exportable.length) {
    return {
      ok: false,
      error: "none of this farm's plots have a valid geometry to export. Run plot QA/QC and fix the boundaries first.",
    };
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

  return { ok: true, data: { farmName, plotCount: exportable.length, skipped, kml } };
}
