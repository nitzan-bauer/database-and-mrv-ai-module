import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { buildFarmKml } from "../kml/buildFarmKml";
import { createZip } from "../kml/zipWriter";

export interface KmzExport {
  farmId: string;
  farmName: string;
  plotCount: number;
  skipped: Array<{ plotId: string; plotName: string }>;
  /** The KMZ file, base64-encoded — a ToolResult travels as JSON, not raw bytes. */
  kmzBase64: string;
  fileName: string;
}

/**
 * KMZ for every plot on a farm — Rebeka's kmz_preparation skill.
 *
 * The same KML `exportPlotsKml` produces (buildFarmKml, shared so the two
 * never drift), wrapped in a single-file ZIP as `doc.kml` — the name every
 * KMZ reader, Google Earth included, looks for by convention. This is the
 * file a VVB or a farmer's own GIS actually expects, rather than raw KML
 * text pasted somewhere.
 */
export async function exportPlotsKmz(
  ctx: ToolContext,
  input: { farmId: string },
): Promise<ToolResult<KmzExport>> {
  const guard = requireDbMode("exportPlotsKmz");
  if (guard) return guard;

  const policy = await checkPolicy("export_plots_kmz", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");

  const built = await buildFarmKml(query, input.farmId);
  if (!built.ok) return fail(`exportPlotsKmz: ${built.error}`);
  const { farmName, plotCount, skipped, kml } = built.data;

  const kmz = createZip([{ name: "doc.kml", data: Buffer.from(kml, "utf8") }]);
  const fileName = `${farmName.replace(/[^a-z0-9]+/gi, "_")}.kmz`;

  await audit(ctx, "export_plots_kmz", { type: "farm", id: input.farmId }, {
    farmName,
    plotCount,
    skipped: skipped.map((s) => s.plotId),
    fileSizeBytes: kmz.length,
  });

  return ok({
    farmId: input.farmId,
    farmName,
    plotCount,
    skipped,
    kmzBase64: kmz.toString("base64"),
    fileName,
  });
}
