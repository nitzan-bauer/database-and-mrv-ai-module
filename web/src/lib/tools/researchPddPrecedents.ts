import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { PDD_PRECEDENTS_DIR } from "../env";

export interface PddPrecedentMatch {
  fileName: string;
  verraProjectId: string | null;
  charCount: number;
  excerpt: string;
}

export interface PddPrecedentResearch {
  corpusSize: number;
  newlyIndexed: number;
  failedToIndex: number;
  remainingToIndex: number;
  matches: PddPrecedentMatch[];
}

/**
 * The real corpus is 300+ PDFs (confirmed against the live folder, not
 * assumed) — extracting all of them in one request would make a single
 * Ask turn run for minutes and risk a timeout. Indexing is incremental
 * and content-addressed (see the sha256 check below), so capping this
 * per call just means the corpus fills in over a few calls rather than
 * one; nothing is lost between them.
 */
const MAX_NEW_PER_CALL = 25;

/** '5970_Draft Project Description_...' -> '5970'. Best-effort; not every file follows it. */
function parseProjectId(fileName: string): string | null {
  const m = fileName.match(/^(\d{3,6})[_ ]/);
  return m ? m[1] : null;
}

const EXCERPT_CHARS = 700;

/**
 * Search real, issued VM0042 PDDs for precedent — the pdd_generator
 * skill's own claim to "research every issued PDD in the category...
 * anchor the draft to the closest projects". Not a Verra registry
 * crawl: registry.verra.org is a client-rendered app fetch_public_url
 * cannot read (confirmed directly, not assumed), so this indexes the
 * real corpus Nitzan has already been curating by hand instead.
 *
 * Indexing is incremental and content-addressed: a file already indexed
 * under its current sha256 is skipped, so re-running this after adding
 * one new PDD to the folder only does the work for that one file.
 */
export async function researchPddPrecedents(
  ctx: ToolContext,
  input: { query?: string; limit?: number },
): Promise<ToolResult<PddPrecedentResearch>> {
  const guard = requireDbMode("researchPddPrecedents");
  if (guard) return guard;

  const policy = await checkPolicy("research_pdd_precedents", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

  let entries: string[];
  try {
    entries = fs.readdirSync(PDD_PRECEDENTS_DIR).filter((f) => /\.pdf$/i.test(f));
  } catch (e) {
    return fail(
      `researchPddPrecedents: could not read ${PDD_PRECEDENTS_DIR} — ${e instanceof Error ? e.message : e}. ` +
        "Set PDD_PRECEDENTS_DIR if the corpus lives somewhere else.",
    );
  }

  const { query } = await import("../db");

  const existing = await query<{ file_name: string; file_sha256: string }>(
    `SELECT file_name, file_sha256 FROM mrv.pdd_precedents`,
  );
  const existingByName = new Map(existing.map((r) => [r.file_name, r.file_sha256]));

  let newlyIndexed = 0;
  let failedToIndex = 0;
  let remainingToIndex = 0;
  for (const fileName of entries) {
    const filePath = path.join(PDD_PRECEDENTS_DIR, fileName);
    let fileBytes: Buffer;
    try {
      fileBytes = fs.readFileSync(filePath);
    } catch {
      failedToIndex++;
      continue;
    }
    const sha256 = createHash("sha256").update(fileBytes).digest("hex");
    if (existingByName.get(fileName) === sha256) continue;

    // Reading + hashing every file is cheap even at 300+ files; actually
    // extracting text (pdf-parse) is the slow step, so the per-call cap
    // applies only to that, and a file that would exceed it is left for
    // the next call rather than blocking this one for minutes.
    if (newlyIndexed >= MAX_NEW_PER_CALL) {
      remainingToIndex++;
      continue;
    }

    let text: string;
    try {
      const { extractPdfText } = await import("../ingest/pdf");
      // Postgres text columns reject a raw NUL byte outright ("invalid byte
      // sequence for encoding UTF8: 0x00") — confirmed live, a real PDF in
      // the corpus produced one via pdf-parse and crashed the whole indexing
      // pass with no audit trail, since the failure is a thrown DB error,
      // not one of this loop's own try/catches. NUL carries no meaning in
      // extracted prose text, so stripping it is lossless in practice.
      text = (await extractPdfText(fileBytes)).replace(/\0/g, "");
    } catch {
      failedToIndex++;
      continue;
    }
    if (!text.trim()) {
      failedToIndex++;
      continue;
    }

    await query(
      `INSERT INTO mrv.pdd_precedents (file_name, verra_project_id, extracted_text, char_count, file_sha256)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (file_name) DO UPDATE SET
         verra_project_id = excluded.verra_project_id,
         extracted_text = excluded.extracted_text,
         char_count = excluded.char_count,
         file_sha256 = excluded.file_sha256,
         indexed_at = clock_timestamp()`,
      [fileName, parseProjectId(fileName), text, text.length, sha256],
    );
    newlyIndexed++;
  }

  const corpus = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.pdd_precedents`);
  const corpusSize = Number(corpus[0].n);

  let rows: Array<{ file_name: string; verra_project_id: string | null; char_count: number; excerpt: string }>;
  if (input.query?.trim()) {
    rows = await query(
      `SELECT file_name, verra_project_id, char_count,
              ts_headline('english', extracted_text, plainto_tsquery('english', $1),
                'MaxFragments=1, MaxWords=100, MinWords=30') AS excerpt
         FROM mrv.pdd_precedents
        WHERE tsv @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', $1)) DESC
        LIMIT $2`,
      [input.query.trim(), limit],
    );
  } else {
    rows = await query(
      `SELECT file_name, verra_project_id, char_count, left(extracted_text, $1) AS excerpt
         FROM mrv.pdd_precedents
        ORDER BY indexed_at DESC
        LIMIT $2`,
      [EXCERPT_CHARS, limit],
    );
  }

  await audit(ctx, "research_pdd_precedents", null, {
    query: input.query ?? null,
    corpusSize,
    newlyIndexed,
    failedToIndex,
    remainingToIndex,
    matched: rows.length,
  });

  return ok({
    corpusSize,
    newlyIndexed,
    failedToIndex,
    remainingToIndex,
    matches: rows.map((r) => ({
      fileName: r.file_name,
      verraProjectId: r.verra_project_id,
      charCount: r.char_count,
      excerpt: r.excerpt,
    })),
  });
}
