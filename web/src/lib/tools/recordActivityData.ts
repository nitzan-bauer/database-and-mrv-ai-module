import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface FertilizerApplicationInput {
  /** Must match a name in mrv.fertilizers exactly — the catalog is the source of n_content and class. */
  fertilizerName: string;
  massT: number;
  intervalYears?: number;
}

export interface RecordedActivityData {
  activityDataId: string;
  farmId: string;
  scenario: "BSL" | "PR" | "WP";
  year: number;
  fertilizerCount: number;
  totalNAppliedT: number;
}

/**
 * Record one farm/scenario/year of GHG Calculator inputs — fuel use,
 * residue burning, N-fixing cover crops, and fertilizer applications.
 *
 * Fertilizers are matched against the live mrv.fertilizers catalog by
 * name, not re-typed by the caller: n_content and class are exactly the
 * numbers the GHG engine's N2O calculation depends on, and letting a
 * caller supply its own n_content for "Urea" would let a typo silently
 * change the emission result. If a name isn't in the catalog, this fails
 * rather than guessing — the catalog is the one place those figures are
 * allowed to live.
 *
 * This is an upsert on (farm_id, scenario, year), matching the table's
 * own unique constraint: re-recording the same farm/scenario/year is
 * treated as a correction (replace the fertilizer lines, update the
 * fuel/residue/n-fix figures), not a duplicate-row error, since this is
 * mutable working data a person may re-enter as estimates firm up.
 */
export async function recordActivityData(
  ctx: ToolContext,
  input: {
    farmId: string;
    scenario: "BSL" | "PR" | "WP";
    year: number;
    areaHa: number;
    dieselL?: number;
    gasolineL?: number;
    residueBurntKg?: number;
    nfixDryMatterT?: number;
    nfixNContent?: number;
    fertilizers?: FertilizerApplicationInput[];
  },
): Promise<ToolResult<RecordedActivityData>> {
  const guard = requireDbMode("recordActivityData");
  if (guard) return guard;

  const policy = await checkPolicy("record_activity_data", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!Number.isFinite(input.areaHa) || input.areaHa <= 0) {
    return fail("recordActivityData: areaHa must be a positive number.");
  }
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > 2100) {
    return fail("recordActivityData: year looks wrong.");
  }
  const numericFields: Array<[string, number | undefined]> = [
    ["dieselL", input.dieselL],
    ["gasolineL", input.gasolineL],
    ["residueBurntKg", input.residueBurntKg],
    ["nfixDryMatterT", input.nfixDryMatterT],
  ];
  for (const [name, v] of numericFields) {
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      return fail(`recordActivityData: ${name} cannot be negative.`);
    }
  }
  if (input.nfixNContent != null && (input.nfixNContent < 0 || input.nfixNContent > 1)) {
    return fail("recordActivityData: nfixNContent must be a fraction between 0 and 1.");
  }
  for (const [i, f] of (input.fertilizers ?? []).entries()) {
    if (!f.fertilizerName?.trim()) return fail(`recordActivityData: fertilizer ${i + 1} has no name.`);
    if (!Number.isFinite(f.massT) || f.massT < 0) {
      return fail(`recordActivityData: fertilizer "${f.fertilizerName}" massT cannot be negative.`);
    }
    if (f.intervalYears != null && (!Number.isInteger(f.intervalYears) || f.intervalYears < 1)) {
      return fail(`recordActivityData: fertilizer "${f.fertilizerName}" intervalYears must be a positive integer.`);
    }
  }

  const { query, withTransaction } = await import("../db");

  const farms = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.farms WHERE farm_id = $1`, [
    input.farmId,
  ]);
  if (Number(farms[0].n) === 0) return fail("recordActivityData: no such farm.");

  // Resolve every fertilizer name against the catalog BEFORE writing
  // anything, so a single typo fails the whole call instead of leaving a
  // half-recorded year.
  const resolvedFertilizers: Array<{
    fertilizerId: string;
    name: string;
    nContent: number;
    fertilizerClass: string;
    massT: number;
    intervalYears: number;
  }> = [];
  for (const f of input.fertilizers ?? []) {
    const rows = await query<{ fertilizer_id: string; name: string; n_content: string; class: string }>(
      `SELECT fertilizer_id, name, n_content, class FROM mrv.fertilizers WHERE name = $1`,
      [f.fertilizerName],
    );
    if (rows.length === 0) {
      return fail(
        `recordActivityData: "${f.fertilizerName}" is not in the fertilizer catalog. ` +
          "Use the exact catalog name, or add it to mrv.fertilizers first.",
      );
    }
    resolvedFertilizers.push({
      fertilizerId: rows[0].fertilizer_id,
      name: rows[0].name,
      nContent: Number(rows[0].n_content),
      fertilizerClass: rows[0].class,
      massT: f.massT,
      intervalYears: f.intervalYears ?? 1,
    });
  }

  const activityDataId = await withTransaction(async (tx) => {
    const upserted = await tx.query<{ activity_data_id: string }>(
      `INSERT INTO mrv.activity_data
         (farm_id, scenario, year, area_ha, diesel_l, gasoline_l, residue_burnt_kg, nfix_dry_matter_t, nfix_n_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (farm_id, scenario, year) DO UPDATE SET
         area_ha = excluded.area_ha,
         diesel_l = excluded.diesel_l,
         gasoline_l = excluded.gasoline_l,
         residue_burnt_kg = excluded.residue_burnt_kg,
         nfix_dry_matter_t = excluded.nfix_dry_matter_t,
         nfix_n_content = excluded.nfix_n_content,
         updated_at = now()
       RETURNING activity_data_id`,
      [
        input.farmId,
        input.scenario,
        input.year,
        input.areaHa,
        input.dieselL ?? 0,
        input.gasolineL ?? 0,
        input.residueBurntKg ?? 0,
        input.nfixDryMatterT ?? 0,
        input.nfixNContent ?? 0,
      ],
    );
    const id = upserted.rows[0].activity_data_id;

    // Re-recording replaces the fertilizer lines wholesale — there is no
    // stable natural key to match old lines against new ones line-by-line.
    await tx.query(`DELETE FROM mrv.fertilizer_applications WHERE activity_data_id = $1`, [id]);
    for (const f of resolvedFertilizers) {
      await tx.query(
        `INSERT INTO mrv.fertilizer_applications
           (activity_data_id, fertilizer_id, fertilizer_name, mass_t, n_content, class, interval_years)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, f.fertilizerId, f.name, f.massT, f.nContent, f.fertilizerClass, f.intervalYears],
      );
    }
    return id;
  });

  const totalNAppliedT = resolvedFertilizers.reduce(
    (sum, f) => sum + Math.round((f.massT / f.intervalYears) * f.nContent * 10000) / 10000,
    0,
  );

  await audit(ctx, "record_activity_data", { type: "activity_data", id: activityDataId }, {
    farmId: input.farmId,
    scenario: input.scenario,
    year: input.year,
    areaHa: input.areaHa,
    fertilizerCount: resolvedFertilizers.length,
    totalNAppliedT: Number(totalNAppliedT.toFixed(4)),
  });

  return ok({
    activityDataId,
    farmId: input.farmId,
    scenario: input.scenario,
    year: input.year,
    fertilizerCount: resolvedFertilizers.length,
    totalNAppliedT: Number(totalNAppliedT.toFixed(4)),
  });
}
