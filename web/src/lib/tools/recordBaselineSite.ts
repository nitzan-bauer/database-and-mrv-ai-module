import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface SimilarityCriterion {
  name: string;
  met: boolean;
  note?: string;
}

export interface RecordedBaselineSite {
  bslId: string;
  areaHa: number;
  distanceKm: number;
  criteriaMet: number;
  criteriaTotal: number;
}

/**
 * Record one QA2 baseline control site — Dave's own responsibility:
 * "Baseline-definition (BSL sites: QA2 ≥3 within 250 km, all 9 Table-7
 * criteria)."
 *
 * Two figures are computed here rather than typed in, because both are
 * exactly the kind of number someone could otherwise nudge to make a site
 * qualify:
 *
 *   - area_ha comes from the geometry itself (ST_Area on the geography
 *     cast), the same discipline runPlotQaQc already applies to plots.
 *   - distance_km is the geodesic distance from the site to the NEAREST
 *     point on any of the farm's own plot boundaries — not a single
 *     reference point, since a multi-plot farm has no one "location" to
 *     measure from, and not a value the caller supplies, since the 250 km
 *     ceiling is a hard methodology limit and a self-reported distance is
 *     exactly the figure a boundary case would be tempted to round down.
 *
 * The 9 similarity criteria of VM0042 v2.2 Table 7 are not hard-coded
 * here. Their exact wording is not something this codebase has the source
 * text for, and inventing plausible-sounding criteria would be the same
 * fabrication this project has refused everywhere else — a manufactured
 * baseline control site is precisely the evidence QA2_3_CONTROL_SITES
 * exists to demand. So the caller supplies whichever criteria it has
 * assessed, each with whether it was met, and this only checks that the
 * shape is sane (a name, and an explicit true/false) — not what the
 * criteria should have been.
 */
export async function recordBaselineSite(
  ctx: ToolContext,
  input: {
    farmId: string;
    /** GeoJSON Polygon (as an object or a JSON string) or WKT 'POLYGON((...))'. */
    geometry: string | Record<string, unknown>;
    linkedPlotId?: string | null;
    criteria: SimilarityCriterion[];
  },
): Promise<ToolResult<RecordedBaselineSite>> {
  const guard = requireDbMode("recordBaselineSite");
  if (guard) return guard;

  const policy = await checkPolicy("record_baseline_site", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.criteria?.length) {
    return fail(
      "recordBaselineSite: at least one similarity criterion is required — VM0042 Table 7 has 9; " +
        "record however many have actually been assessed.",
    );
  }
  for (const [i, c] of input.criteria.entries()) {
    if (!c.name?.trim()) return fail(`recordBaselineSite: criterion ${i + 1} has no name.`);
    if (typeof c.met !== "boolean") {
      return fail(`recordBaselineSite: criterion "${c.name}" must state met: true or false, not omit it.`);
    }
  }

  const geomText =
    typeof input.geometry === "string" ? input.geometry.trim() : JSON.stringify(input.geometry);
  if (!geomText) return fail("recordBaselineSite: a geometry is required.");

  const { query } = await import("../db");

  const farms = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.farms WHERE farm_id = $1`, [
    input.farmId,
  ]);
  if (Number(farms[0].n) === 0) return fail("recordBaselineSite: no such farm.");

  if (input.linkedPlotId) {
    const plots = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.plots WHERE plot_id = $1 AND farm_id = $2`,
      [input.linkedPlotId, input.farmId],
    );
    if (Number(plots[0].n) === 0) {
      return fail("recordBaselineSite: linkedPlotId does not belong to this farm.");
    }
  }

  // Parse as GeoJSON if it looks like JSON, otherwise as WKT. Either way,
  // PostGIS itself validates and measures it — nothing here re-derives
  // geometry math by hand.
  const looksLikeJson = geomText.startsWith("{");
  const parsed = await query<{
    valid: boolean;
    reason: string | null;
    area_ha: string | null;
    distance_km: string | null;
  }>(
    `WITH g AS (
       SELECT ${looksLikeJson ? "ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)" : "ST_GeomFromText($1, 4326)"} AS geom
     )
     SELECT
       ST_IsValid(g.geom) AS valid,
       CASE WHEN NOT ST_IsValid(g.geom) THEN ST_IsValidReason(g.geom) END AS reason,
       CASE WHEN ST_IsValid(g.geom) THEN (ST_Area(g.geom::geography) / 10000.0)::text END AS area_ha,
       CASE WHEN ST_IsValid(g.geom) THEN (
         (SELECT min(ST_Distance(p.geom::geography, g.geom::geography)) / 1000.0
            FROM mrv.plots p WHERE p.farm_id = $2)
       )::text END AS distance_km
     FROM g`,
    [geomText, input.farmId],
  ).catch((e: Error) => {
    throw new Error(`recordBaselineSite: could not parse the geometry — ${e.message}`);
  });

  const row = parsed[0];
  if (!row?.valid) {
    return fail(
      `recordBaselineSite: the geometry is not valid${row?.reason ? ` (${row.reason})` : ""}.`,
    );
  }
  if (row.distance_km == null) {
    return fail("recordBaselineSite: this farm has no plots yet, so distance cannot be measured against it.");
  }

  const areaHa = Number(row.area_ha);
  const distanceKm = Number(row.distance_km);
  if (distanceKm > 250) {
    return fail(
      `recordBaselineSite: this site is ${distanceKm.toFixed(1)} km from the nearest plot — over VM0042's ` +
        "250 km ceiling (Table 7). It cannot be used as a control site for this farm.",
    );
  }

  const inserted = await query<{ bsl_id: string }>(
    `INSERT INTO mrv.baseline_control_sites
       (farm_id, linked_plot_id, geom, area_ha, distance_km, similarity_criteria)
     SELECT $2, $3,
            ${looksLikeJson ? "ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)" : "ST_GeomFromText($1, 4326)"},
            $4, $5, $6::jsonb
     RETURNING bsl_id`,
    [
      geomText,
      input.farmId,
      input.linkedPlotId ?? null,
      areaHa,
      distanceKm,
      JSON.stringify(input.criteria),
    ],
  );
  const bslId = inserted[0].bsl_id;

  const criteriaMet = input.criteria.filter((c) => c.met).length;

  await audit(ctx, "record_baseline_site", { type: "baseline_control_site", id: bslId }, {
    farmId: input.farmId,
    areaHa: Number(areaHa.toFixed(4)),
    distanceKm: Number(distanceKm.toFixed(3)),
    criteriaMet,
    criteriaTotal: input.criteria.length,
    criteria: input.criteria.map((c) => ({ name: c.name, met: c.met })),
  });

  return ok({ bslId, areaHa, distanceKm, criteriaMet, criteriaTotal: input.criteria.length });
}
