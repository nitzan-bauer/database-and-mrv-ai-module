import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { listDriveFolderFiles, downloadDriveFile } from "../google/driveClient";
import { readZip } from "../ingest/zip";

export interface KickoffDateFinding {
  clientFolder: string;
  fileName: string;
  /** ISO yyyy-mm-dd, or null when the file couldn't be read or had no recognisable date. */
  dateFound: string | null;
  detail?: string;
}

export interface ResearchProjectKickoffDateResult {
  filesScanned: number;
  findings: KickoffDateFinding[];
  earliestDate: string | null;
  earliestFromClient: string | null;
  projectStartDateUpdated: boolean;
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

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Deliberately broad rather than tuned to one exact layout — these reports
 * come from different client onboarding calls and nobody has verified they
 * all share one date format. Every match is kept with the line it came
 * from (see caller) so a wrong parse is visible and correctable, not
 * silently trusted.
 */
function findDatesInText(text: string): Date[] {
  const found: Date[] = [];
  const monthName = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

  // "15 March 2026" / "15th March 2026". Digit side uses a not-a-digit
  // lookaround rather than \b: a real kick-off report glues its own field
  // labels straight onto values with no separator ("DATE2026-08-07LOCATION"
  // — confirmed live), and \b does not fire between two \w characters
  // (a letter and a digit both count as \w), so it silently missed real
  // dates sitting right next to a label. A digit is only ever the real
  // boundary of a date, never a letter.
  for (const m of text.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}\\.?\\s+(\\d{4})(?!\\d)`, "gi"))) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) continue;
    found.push(new Date(Date.UTC(Number(m[3]), month, Number(m[1]))));
  }
  // "March 15, 2026" / "March 15 2026"
  for (const m of text.matchAll(new RegExp(`${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, "gi"))) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) continue;
    found.push(new Date(Date.UTC(Number(m[3]), month, Number(m[2]))));
  }
  // "15/03/2026" or "15-03-2026" (day/month/year — East African convention, not US)
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?!\d)/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (day > 31 || month > 11) continue;
    found.push(new Date(Date.UTC(Number(m[3]), month, day)));
  }
  // "2026-03-15" (ISO) — the format this project's own kick-off template uses
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) {
    const month = Number(m[2]) - 1;
    if (month > 11) continue;
    found.push(new Date(Date.UTC(Number(m[1]), month, Number(m[3]))));
  }

  return found.filter((d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100);
}

/**
 * Prefers a date found on a line that actually mentions the meeting/date —
 * a document can carry other, unrelated dates (a footer print-date, a
 * reference to some other event) that would silently win a bare "earliest
 * date in the whole file" search. Falls back to any date in the file only
 * if no such line exists, rather than returning nothing.
 */
function findMeetingDate(text: string): Date | null {
  const lines = text.split("\n");
  // No \b here either — same glued-label reason as findDatesInText above
  // ("DATE2026-08-07" has no word boundary right after "DATE").
  const relevant = lines.filter((l) => /date|meeting|kick.?off/i.test(l));
  const fromRelevant = findDatesInText(relevant.join("\n"));
  if (fromRelevant.length) return fromRelevant.sort((a, b) => a.getTime() - b.getTime())[0];
  const fromWhole = findDatesInText(text);
  return fromWhole.length ? fromWhole.sort((a, b) => a.getTime() - b.getTime())[0] : null;
}

/**
 * Real activity start ("Project Start Date", section 1.8) is a different
 * fact from the crediting period start Verra defines — it's when
 * onboarding actually began, and the earliest real Project Kick-off
 * Meeting report is the honest, documented source for it. Scans every
 * client subfolder under the project's own FARMERS Drive folder (set once
 * via mrv.projects.farmers_drive_folder_id — Nitzan's own instruction:
 * "so Rebeka knows where to look"), extracts real text from each
 * Kick-off Meeting report, and takes the true minimum date found —
 * never a guess, never an invented default.
 */
export async function researchProjectKickoffDate(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<ResearchProjectKickoffDateResult>> {
  const guard = requireDbMode("researchProjectKickoffDate");
  if (guard) return guard;

  const policy = await checkPolicy("research_project_kickoff_date", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("researchProjectKickoffDate: no Google Drive access token for this session — sign in with Drive access.");
  }

  const { query } = await import("../db");

  const projects = await query<{ farmers_drive_folder_id: string | null; excluded_kickoff_folder_ids: string[] }>(
    `SELECT farmers_drive_folder_id, excluded_kickoff_folder_ids FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("researchProjectKickoffDate: no such project.");
  const folderId = projects[0].farmers_drive_folder_id;
  if (!folderId) {
    return fail(
      "researchProjectKickoffDate: no FARMERS Drive folder is linked to this project yet — link mrv.projects.farmers_drive_folder_id first.",
    );
  }
  const excluded = new Set(projects[0].excluded_kickoff_folder_ids ?? []);

  let topLevel;
  try {
    topLevel = await listDriveFolderFiles(ctx.googleAccessToken, folderId);
  } catch (e) {
    return fail(`researchProjectKickoffDate: could not read the FARMERS folder — ${e instanceof Error ? e.message : e}.`);
  }
  // Excludes demo/test client folders confirmed by a person (Nitzan's
  // own instruction, live: "NITZAN ISRAEL folder is a DEMO, don't
  // reference it") — a real Drive folder id, not a name guess, so a
  // later rename of the real folder can't silently un-exclude it.
  const clientFolders = topLevel.filter((f) => f.mimeType === "application/vnd.google-apps.folder" && !excluded.has(f.id));
  const foldersToScan = clientFolders.length ? clientFolders : [{ id: folderId, name: "(FARMERS folder itself)" }];

  const findings: KickoffDateFinding[] = [];

  for (const cf of foldersToScan) {
    let files;
    try {
      files = await listDriveFolderFiles(ctx.googleAccessToken, cf.id);
    } catch (e) {
      findings.push({ clientFolder: cf.name, fileName: "(folder)", dateFound: null, detail: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const matches = files.filter((f) => /kick.?off/i.test(f.name));
    for (const m of matches) {
      let text = "";
      try {
        const bytes = await downloadDriveFile(ctx.googleAccessToken, m.id);
        if (/\.pdf$/i.test(m.name)) {
          const { extractPdfText } = await import("../ingest/pdf");
          text = (await extractPdfText(bytes)).replace(/\0/g, "");
        } else if (/\.docx$/i.test(m.name)) {
          text = docxText(bytes).replace(/\0/g, "");
        } else {
          findings.push({ clientFolder: cf.name, fileName: m.name, dateFound: null, detail: "unsupported file type" });
          continue;
        }
      } catch (e) {
        findings.push({ clientFolder: cf.name, fileName: m.name, dateFound: null, detail: e instanceof Error ? e.message : String(e) });
        continue;
      }
      const date = findMeetingDate(text);
      findings.push({
        clientFolder: cf.name,
        fileName: m.name,
        dateFound: date ? date.toISOString().slice(0, 10) : null,
        detail: date ? undefined : "no recognisable date found in the file",
      });
    }
  }

  const withDates = findings.filter((f): f is KickoffDateFinding & { dateFound: string } => f.dateFound !== null);
  if (!withDates.length) {
    return ok({ filesScanned: findings.length, findings, earliestDate: null, earliestFromClient: null, projectStartDateUpdated: false });
  }
  const earliest = withDates.reduce((a, b) => (a.dateFound < b.dateFound ? a : b));

  // Always overwrites with the current run's real answer, never only
  // "if earlier" — the DB is the source of truth for the current state
  // of the FARMERS folder (same policy the PDD doc itself follows), and
  // an "only ever decrease" guard would have permanently locked in a
  // wrong value once one bad run (e.g. an unexcluded demo folder)
  // produced a date earlier than the true one.
  await query(`UPDATE mrv.projects SET project_start_date = $2::date WHERE project_id = $1`, [
    input.projectId,
    earliest.dateFound,
  ]);

  await audit(ctx, "research_project_kickoff_date", { type: "project", id: input.projectId }, {
    earliestDate: earliest.dateFound,
    earliestFromClient: earliest.clientFolder,
    filesScanned: findings.length,
  });

  return ok({
    filesScanned: findings.length,
    findings,
    earliestDate: earliest.dateFound,
    earliestFromClient: earliest.clientFolder,
    projectStartDateUpdated: true,
  });
}
