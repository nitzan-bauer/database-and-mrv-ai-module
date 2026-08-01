import "server-only";
import { audit, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

/** One SOC row as it comes out of the datasheet parser. */
export interface SocRow {
  /** Which captured point this depth increment came from. */
  pointId: string;
  depthTopCm: number;
  depthBaseCm: number;
  bulkDensity: number;
  toc400Pct: number;
  roc600Pct?: number | null;
  tic900Pct?: number | null;
  nPct?: number | null;
  smallCfPct?: number | null;
  largeCfPct?: number | null;
  drySampleMassG?: number | null;
  probeAreaCm2?: number | null;
  method?: string;
  analysisDate?: string | null;
  barcode?: string | null;
}

export interface IngestResult {
  importId: string;
  samplesCreated: number;
  measurementsCreated: number;
  quarantined: Array<{ rowIndex: number; error: string }>;
}

/**
 * Persist a parsed SOC datasheet as samples and measurements.
 *
 * Two decisions shape this, and both come from the tables being append-only.
 *
 * A bad row is quarantined, not dropped. mrv.import_quarantine keeps the raw
 * row and the reason beside the import it came from. A dropped row is a
 * silent hole in a dataset a VVB will reconcile against the lab's own
 * report; a quarantined one is a visible discrepancy someone can resolve.
 * The import still succeeds — one unreadable line should not cost the other
 * fifty.
 *
 * Nothing is ever updated. Re-importing a corrected figure adds a new
 * measurement with the next replicate number, and the earlier one stays
 * exactly where it was. That is what append-only is for: the record shows a
 * value was corrected and when, rather than showing only the value someone
 * settled on.
 *
 * SOC itself is not computed here. mrv.soc_measurements derives toc_pct,
 * soc_t_per_ha and soil_mass_t_ha as generated columns, so the arithmetic
 * lives in one place and cannot be written wrong by a caller.
 *
 * The rows are validated in a first pass and written in a second. That is
 * not tidiness: mrv.lab_imports is append-only, so the obvious shape —
 * open an import, write rows into it, then update it with the totals —
 * cannot work. The import row has to be written once, already knowing how
 * many rows succeeded and how many were quarantined, which means finding
 * that out before it exists.
 */
export async function ingestLabResults(
  ctx: ToolContext,
  input: {
    farmId: string;
    cycleId: string;
    workOrderId?: string | null;
    labName: string;
    workbookUrl: string;
    workbookSha256?: string | null;
    datasheetVersion?: string | null;
    rows: SocRow[];
  },
): Promise<ToolResult<IngestResult>> {
  const guard = requireDbMode("ingestLabResults");
  if (guard) return guard;

  if (!input.rows?.length) return fail("ingestLabResults: the datasheet has no rows.");
  if (!input.labName?.trim()) {
    return fail(
      "ingestLabResults: the lab must be named. VM0042 §8.2.1.4 turns on the lab's accreditation, " +
        "so a measurement with no lab attached cannot be assessed.",
    );
  }
  if (!input.workbookUrl?.trim()) {
    return fail("ingestLabResults: the original workbook must be kept — it is the source evidence.");
  }

  const { query, withTransaction } = await import("../db");

  const labRows = await query<{ lab_id: string; iso_17025: boolean }>(
    `INSERT INTO mrv.labs (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET updated_at = clock_timestamp()
     RETURNING lab_id, iso_17025`,
    [input.labName.trim()],
  );
  const { lab_id: labId, iso_17025: accredited } = labRows[0];

  const result = await withTransaction(async (tx) => {
    /* ---- pass one: resolve every row, writing nothing ---------------- */
    const accepted: Array<{ row: SocRow; eventId: string; samplingDate: string }> = [];
    const quarantined: IngestResult["quarantined"] = [];

    for (const [idx, r] of input.rows.entries()) {
      try {
        if (!(r.depthBaseCm > r.depthTopCm)) {
          throw new Error(
            `depth ${r.depthTopCm}-${r.depthBaseCm} cm is not an increment — an SOC sample spans a depth range`,
          );
        }
        if (!(r.bulkDensity > 0 && r.bulkDensity < 3)) {
          throw new Error(`bulk density ${r.bulkDensity} g/cm3 is outside the plausible range for soil`);
        }
        if (!(r.toc400Pct >= 0)) throw new Error(`TOC400 ${r.toc400Pct}% is not a valid percentage`);

        // The event this depth belongs to. No event means the point was
        // never captured in the field, so a lab result for it is a result
        // for soil nobody recorded taking.
        const ev = await tx.query<{ event_id: string; farm_id: string; sampling_date: string }>(
          `SELECT e.event_id, p.farm_id, e.sampling_date
             FROM mrv.sampling_events e
             JOIN mrv.sampling_points sp ON sp.point_id = e.point_id
             JOIN mrv.plots p ON p.plot_id = sp.plot_id
            WHERE e.point_id = $1 AND e.cycle_id = $2`,
          [r.pointId, input.cycleId],
        );
        if (!ev.rows.length) {
          throw new Error("no sampling event for this point in this cycle — it was never captured in the field");
        }
        if (ev.rows[0].farm_id !== input.farmId) {
          throw new Error("this point belongs to a different farm");
        }

        accepted.push({
          row: r,
          eventId: ev.rows[0].event_id,
          samplingDate: ev.rows[0].sampling_date,
        });
      } catch (e) {
        quarantined.push({ rowIndex: idx, error: e instanceof Error ? e.message : String(e) });
      }
    }

    /* ---- the import record, written once, already knowing the outcome -- */
    const imp = await tx.query<{ import_id: string }>(
      `INSERT INTO mrv.lab_imports
         (farm_id, wo_id, lab_id, workbook_url, workbook_sha256, datasheet_version,
          parser_status, rows_parsed, rows_failed, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::mrv.parser_status, $8, $9, $10)
       RETURNING import_id`,
      [
        input.farmId,
        input.workOrderId ?? null,
        labId,
        input.workbookUrl.trim(),
        input.workbookSha256 ?? null,
        input.datasheetVersion ?? null,
        quarantined.length === 0 ? "success" : accepted.length === 0 ? "quarantined" : "partial",
        accepted.length,
        quarantined.length,
        ctx.actor,
      ],
    );
    const importId = imp.rows[0].import_id;

    for (const q of quarantined) {
      await tx.query(
        `INSERT INTO mrv.import_quarantine (import_id, row_index, raw_row, error)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [importId, q.rowIndex, JSON.stringify(input.rows[q.rowIndex]), q.error],
      );
    }

    /* ---- pass two: the measurements themselves ----------------------- */
    let samplesCreated = 0;
    let measurementsCreated = 0;

    for (const a of accepted) {
      const r = a.row;

      const smp = await tx.query<{ sample_id: string }>(
        `INSERT INTO mrv.samples
           (event_id, farm_id, sample_type, scenario, depth_top_cm, depth_base_cm,
            composite_cores, barcode, sampling_date)
         SELECT $1, $2, 'soc', sp.scenario, $3, $4, sp.composite_cores, $5, $6
           FROM mrv.sampling_points sp WHERE sp.point_id = $7
         ON CONFLICT (event_id, sample_type, depth_top_cm, depth_base_cm) DO NOTHING
         RETURNING sample_id`,
        [
          a.eventId,
          input.farmId,
          r.depthTopCm,
          r.depthBaseCm,
          r.barcode ?? null,
          a.samplingDate,
          r.pointId,
        ],
      );

      let sampleId: string;
      if (smp.rows.length) {
        sampleId = smp.rows[0].sample_id;
        samplesCreated++;
      } else {
        // Already present — mrv.samples is append-only, so the existing one
        // is reused and this figure becomes another replicate against it.
        const found = await tx.query<{ sample_id: string }>(
          `SELECT sample_id FROM mrv.samples
            WHERE event_id = $1 AND sample_type = 'soc' AND depth_top_cm = $2 AND depth_base_cm = $3`,
          [a.eventId, r.depthTopCm, r.depthBaseCm],
        );
        sampleId = found.rows[0].sample_id;
      }

      const rep = await tx.query<{ next: string }>(
        `SELECT coalesce(max(replicate_no), 0) + 1 AS next
           FROM mrv.soc_measurements WHERE sample_id = $1`,
        [sampleId],
      );

      await tx.query(
        `INSERT INTO mrv.soc_measurements
           (sample_id, lab_import_id, lab_id, method, analysis_date, replicate_no,
            depth_top_cm, depth_base_cm, bulk_density, small_cf_pct, large_cf_pct,
            dry_sample_mass_g, probe_area_cm2, toc_400_pct, roc_600_pct, tic_900_pct, n_pct)
         VALUES ($1,$2,$3,$4::mrv.lab_method,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          sampleId,
          importId,
          labId,
          r.method ?? "dry_combustion",
          r.analysisDate ?? null,
          Number(rep.rows[0].next),
          r.depthTopCm,
          r.depthBaseCm,
          r.bulkDensity,
          r.smallCfPct ?? null,
          r.largeCfPct ?? null,
          r.drySampleMassG ?? null,
          r.probeAreaCm2 ?? null,
          r.toc400Pct,
          r.roc600Pct ?? null,
          r.tic900Pct ?? null,
          r.nPct ?? null,
        ],
      );
      measurementsCreated++;

      await tx.query(
        `UPDATE mrv.sampling_points SET status = 'lab_pending', updated_at = clock_timestamp()
          WHERE point_id = $1 AND status = 'sampled'`,
        [r.pointId],
      );
    }

    return { importId, samplesCreated, measurementsCreated, quarantined };
  });

  const warnings: string[] = [];
  if (!accredited) {
    warnings.push(
      `${input.labName} is not recorded as ISO 17025 accredited. VM0042 §8.2.1.4 requires it, ` +
        "so the compliance check will fail until the accreditation is recorded in Admin.",
    );
  }
  if (result.quarantined.length) {
    warnings.push(
      `${result.quarantined.length} row(s) were quarantined rather than imported — see the import for the reasons.`,
    );
  }

  await audit(ctx, "ingest_lab_results", { type: "lab_import", id: result.importId }, {
    farmId: input.farmId,
    cycleId: input.cycleId,
    workOrderId: input.workOrderId ?? null,
    lab: input.labName.trim(),
    labAccredited: accredited,
    workbookSha256: input.workbookSha256 ?? null,
    rowsIn: input.rows.length,
    samplesCreated: result.samplesCreated,
    measurementsCreated: result.measurementsCreated,
    quarantined: result.quarantined.length,
  });

  return ok(result, warnings);
}
