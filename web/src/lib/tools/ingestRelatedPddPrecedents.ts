import "server-only";
import { createHash } from "node:crypto";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { listDriveFolderFiles, downloadDriveFile } from "../google/driveClient";
import { ensureProjectDriveFolder } from "../google/ensureProjectFolder";
import { ensureSubfolder } from "../google/driveClient";
import { readZip } from "../ingest/zip";

export interface IngestedPrecedentFile {
  fileName: string;
  verraProjectId: string;
  outcome: "indexed" | "unchanged" | "unsupported_type" | "empty" | "error";
  detail?: string;
}

export interface IngestRelatedPddPrecedentsResult {
  filesSeen: number;
  indexed: number;
  files: IngestedPrecedentFile[];
}

function docxText(buf: Buffer): string {
  const entries = readZip(buf);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) return "";
  return doc.data
    .toString("utf8")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * The RELATED PDDS folder (download_related_pdds, 0059) puts real files
 * in Drive, but "in Drive" and "in Rebeka's precedent search" are two
 * different things — mrv.pdd_precedents (0048) is what
 * research_pdd_precedents and the drafting pipeline's ts_headline search
 * actually query, and nothing wrote to it from that folder. This closes
 * that gap: walk each per-Verra-project subfolder, extract real text
 * from the PDF/DOCX files (KML/XLSX/etc. carry no narrative precedent
 * and are skipped), and index them the same content-addressed way
 * researchPddPrecedents.ts does for the hand-curated local corpus —
 * sha256-keyed, so re-running this after a new related-PDD download only
 * does the work for what's actually new.
 */
export async function ingestRelatedPddPrecedents(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<IngestRelatedPddPrecedentsResult>> {
  const guard = requireDbMode("ingestRelatedPddPrecedents");
  if (guard) return guard;

  const policy = await checkPolicy("ingest_related_pdd_precedents", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("ingestRelatedPddPrecedents: no Google Drive access token for this session — sign in with Drive access.");
  }

  const { query } = await import("../db");

  const projects = await query<{ name: string }>(`SELECT name FROM mrv.projects WHERE project_id = $1`, [input.projectId]);
  if (!projects.length) return fail("ingestRelatedPddPrecedents: no such project.");

  let relatedFolderId: string;
  try {
    const projectFolderId = await ensureProjectDriveFolder(ctx.googleAccessToken, input.projectId, projects[0].name);
    relatedFolderId = await ensureSubfolder(ctx.googleAccessToken, projectFolderId, "RELATED PDDS");
  } catch (e) {
    return fail(`ingestRelatedPddPrecedents: could not reach the RELATED PDDS folder — ${e instanceof Error ? e.message : e}.`);
  }

  const subfolders = await listDriveFolderFiles(ctx.googleAccessToken, relatedFolderId);
  const verraSubfolders = subfolders.filter((f) => f.mimeType === "application/vnd.google-apps.folder");

  const existing = await query<{ file_name: string; file_sha256: string }>(`SELECT file_name, file_sha256 FROM mrv.pdd_precedents`);
  const existingByName = new Map(existing.map((r) => [r.file_name, r.file_sha256]));

  const files: IngestedPrecedentFile[] = [];

  for (const sub of verraSubfolders) {
    const verraProjectId = sub.name;
    let docs;
    try {
      docs = await listDriveFolderFiles(ctx.googleAccessToken, sub.id);
    } catch (e) {
      files.push({ fileName: sub.name, verraProjectId, outcome: "error", detail: e instanceof Error ? e.message : String(e) });
      continue;
    }

    for (const doc of docs) {
      const isPdf = /\.pdf$/i.test(doc.name);
      const isDocx = /\.docx$/i.test(doc.name);
      if (!isPdf && !isDocx) {
        files.push({ fileName: doc.name, verraProjectId, outcome: "unsupported_type" });
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await downloadDriveFile(ctx.googleAccessToken, doc.id);
      } catch (e) {
        files.push({ fileName: doc.name, verraProjectId, outcome: "error", detail: e instanceof Error ? e.message : String(e) });
        continue;
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const precedentFileName = `related-${verraProjectId}-${doc.name}`;
      if (existingByName.get(precedentFileName) === sha256) {
        files.push({ fileName: doc.name, verraProjectId, outcome: "unchanged" });
        continue;
      }

      let text: string;
      try {
        // Postgres text columns reject a raw NUL byte outright — pdf-parse
        // has been seen to emit one from a malformed content stream
        // (confirmed live via researchPddPrecedents.ts crashing on it).
        if (isPdf) {
          const { extractPdfText } = await import("../ingest/pdf");
          text = (await extractPdfText(bytes)).replace(/\0/g, "");
        } else {
          text = docxText(bytes).replace(/\0/g, "");
        }
      } catch (e) {
        files.push({ fileName: doc.name, verraProjectId, outcome: "error", detail: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (!text.trim()) {
        files.push({ fileName: doc.name, verraProjectId, outcome: "empty" });
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
        [precedentFileName, verraProjectId, text, text.length, sha256],
      );
      files.push({ fileName: doc.name, verraProjectId, outcome: "indexed" });
    }
  }

  const indexed = files.filter((f) => f.outcome === "indexed").length;

  await audit(ctx, "ingest_related_pdd_precedents", { type: "project", id: input.projectId }, {
    filesSeen: files.length,
    indexed,
  });

  return ok({ filesSeen: files.length, indexed, files });
}
