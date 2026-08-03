import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export type MvrStatus = "draft" | "ime_review" | "signed";

export interface MvrSignoffInput {
  runId: string;
  meanBias?: number | null;
  pooledMeasUnc?: number | null;
  coveragePct?: number | null;
  imeName?: string | null;
  /** Always the VVB per VMD0053 — the proponent never contracts its own IME. */
  imeContractedBy?: string;
  documentUrl?: string | null;
  imeReportUrl?: string | null;
  registryUrl?: string | null;
  signedAt?: string | null;
}

export interface RecordedMvrSignoff {
  mvrId: string;
  runId: string;
  status: MvrStatus;
  biasWithinPmu: boolean | null;
  coveragePass: boolean | null;
}

/**
 * Record the VMD0053 v2.1 Model Validation Report + IME sign-off for a
 * model run — the single most consequential record in the QA1 chain,
 * since it is what a VVB reads to decide whether a run's SOC change can
 * be claimed at all.
 *
 * biasWithinPmu and coveragePass are not judgement calls: VMD0053 states
 * both thresholds plainly (bias must sit within the pooled measurement
 * uncertainty; the prediction interval must cover >=90% of validation
 * observations), so both are computed here from whatever inputs are
 * given rather than asked of the caller — the same discipline
 * equation74 applies to its own deduction.
 *
 * ime_contracted_by is enforced at 'VVB', not merely defaulted to it:
 * VMD0053 §5's whole point is that the IME is hired by the VVB, never
 * the proponent, and accepting a proponent-contracted IME here would
 * mean turning that specific failing check green.
 *
 * mrv.mvr is not append-only (unlike model_results) — a run's MVR moves
 * through draft -> ime_review -> signed as real work on it progresses,
 * so this upserts on run_id rather than refusing a second call.
 */
export async function recordMvrSignoff(
  ctx: ToolContext,
  input: MvrSignoffInput,
): Promise<ToolResult<RecordedMvrSignoff>> {
  const guard = requireDbMode("recordMvrSignoff");
  if (guard) return guard;

  const policy = await checkPolicy("record_mvr_signoff", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const imeContractedBy = input.imeContractedBy?.trim() || "VVB";
  if (imeContractedBy !== "VVB") {
    return fail(
      `recordMvrSignoff: ime_contracted_by must be "VVB" — VMD0053 requires the IME be contracted by the VVB, ` +
        `never the proponent; "${imeContractedBy}" would record exactly the violation this check exists to catch.`,
    );
  }
  if (input.coveragePct != null && (input.coveragePct < 0 || input.coveragePct > 100)) {
    return fail("recordMvrSignoff: coveragePct must be between 0 and 100.");
  }
  if (input.signedAt != null && Number.isNaN(Date.parse(input.signedAt))) {
    return fail(`recordMvrSignoff: signedAt "${input.signedAt}" is not a valid date.`);
  }

  const { query } = await import("../db");

  const runs = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.model_runs WHERE run_id = $1`, [
    input.runId,
  ]);
  if (Number(runs[0].n) === 0) return fail("recordMvrSignoff: no such model run.");

  const biasWithinPmu =
    input.meanBias != null && input.pooledMeasUnc != null ? Math.abs(input.meanBias) <= input.pooledMeasUnc : null;
  const coveragePass = input.coveragePct != null ? input.coveragePct >= 90 : null;

  const status: MvrStatus = input.signedAt ? "signed" : input.imeName ? "ime_review" : "draft";

  const rows = await query<{ mvr_id: string }>(
    `INSERT INTO mrv.mvr
       (run_id, status, mean_bias, pooled_meas_unc, bias_within_pmu, coverage_pct, coverage_pass,
        ime_name, ime_contracted_by, document_url, ime_report_url, registry_url, signed_at)
     VALUES ($1,$2::mrv.mvr_status,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (run_id) DO UPDATE SET
       status = excluded.status,
       mean_bias = excluded.mean_bias,
       pooled_meas_unc = excluded.pooled_meas_unc,
       bias_within_pmu = excluded.bias_within_pmu,
       coverage_pct = excluded.coverage_pct,
       coverage_pass = excluded.coverage_pass,
       ime_name = excluded.ime_name,
       ime_contracted_by = excluded.ime_contracted_by,
       document_url = excluded.document_url,
       ime_report_url = excluded.ime_report_url,
       registry_url = excluded.registry_url,
       signed_at = excluded.signed_at,
       updated_at = clock_timestamp()
     RETURNING mvr_id`,
    [
      input.runId,
      status,
      input.meanBias ?? null,
      input.pooledMeasUnc ?? null,
      biasWithinPmu,
      input.coveragePct ?? null,
      coveragePass,
      input.imeName ?? null,
      imeContractedBy,
      input.documentUrl ?? null,
      input.imeReportUrl ?? null,
      input.registryUrl ?? null,
      input.signedAt ?? null,
    ],
  );
  const mvrId = rows[0].mvr_id;

  await audit(ctx, "record_mvr_signoff", { type: "mvr", id: mvrId }, {
    runId: input.runId,
    status,
    biasWithinPmu,
    coveragePass,
    imeContractedBy,
  });

  return ok({ mvrId, runId: input.runId, status, biasWithinPmu, coveragePass });
}
