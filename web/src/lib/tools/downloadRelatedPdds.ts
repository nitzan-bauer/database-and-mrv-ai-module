import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { ensureSubfolder, uploadFileToDriveFolder } from "../google/driveClient";
import { ensureProjectDriveFolder } from "../google/ensureProjectFolder";
import { fetchVerraProjectDocuments, downloadVerraDocument, guessMimeType } from "../verra/documents";

export interface DownloadedRelatedPddResult {
  verraProjectId: string;
  filesUploaded: Array<{ name: string; driveFileId: string }>;
  error?: string;
}

export interface DownloadRelatedPddsResult {
  relatedPddsFolderId: string;
  relatedPddsFolderUrl: string;
  projects: DownloadedRelatedPddResult[];
}

/**
 * Real related-PDD files, not a list of links Nitzan has to click through
 * himself. For each Verra project id given, pulls its real document list
 * and downloads every file (the PDD itself, the listing representation,
 * public comment summary, project boundary) straight from Verra's public
 * registry backend into a "RELATED PDDS" subfolder under this project's
 * own Drive folder — no browser, no manual save dialog.
 *
 * Which projects are "related" is not something this tool decides —
 * Nitzan names some directly, and search_verra_registry (VM0042,
 * similar country/activity) is how Rebeka finds more to add to the list.
 * This tool's only job is turning a Verra project id into real files in
 * the right place.
 */
export async function downloadRelatedPdds(
  ctx: ToolContext,
  input: { projectId: string; verraProjectIds: string[] },
): Promise<ToolResult<DownloadRelatedPddsResult>> {
  const guard = requireDbMode("downloadRelatedPdds");
  if (guard) return guard;

  const policy = await checkPolicy("download_related_pdds", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("downloadRelatedPdds: no Google Drive access token for this session — sign in with Drive access.");
  }
  if (!input.verraProjectIds?.length) {
    return fail("downloadRelatedPdds: at least one verraProjectIds entry is required.");
  }

  const { query } = await import("../db");

  const projects = await query<{ name: string }>(`SELECT name FROM mrv.projects WHERE project_id = $1`, [input.projectId]);
  if (!projects.length) return fail("downloadRelatedPdds: no such project.");

  let projectFolderId: string;
  try {
    projectFolderId = await ensureProjectDriveFolder(query, ctx.googleAccessToken, input.projectId, projects[0].name);
  } catch (e) {
    return fail(`downloadRelatedPdds: could not reach the project's Drive folder — ${e instanceof Error ? e.message : e}.`);
  }

  let relatedFolderId: string;
  try {
    relatedFolderId = await ensureSubfolder(ctx.googleAccessToken, projectFolderId, "RELATED PDDS");
  } catch (e) {
    return fail(`downloadRelatedPdds: could not create the RELATED PDDS folder — ${e instanceof Error ? e.message : e}.`);
  }

  const results: DownloadedRelatedPddResult[] = [];

  for (const verraProjectId of input.verraProjectIds) {
    try {
      const docs = await fetchVerraProjectDocuments(verraProjectId);
      if (!docs.length) {
        results.push({ verraProjectId, filesUploaded: [], error: "no documents listed for this project on Verra's registry" });
        continue;
      }
      let subfolderId: string;
      try {
        subfolderId = await ensureSubfolder(ctx.googleAccessToken, relatedFolderId, verraProjectId);
      } catch (e) {
        results.push({ verraProjectId, filesUploaded: [], error: `could not create subfolder: ${e instanceof Error ? e.message : e}` });
        continue;
      }

      const filesUploaded: Array<{ name: string; driveFileId: string }> = [];
      for (const doc of docs) {
        try {
          const bytes = await downloadVerraDocument(doc.id);
          const file = await uploadFileToDriveFolder(ctx.googleAccessToken, subfolderId, doc.name, guessMimeType(doc.name), bytes);
          filesUploaded.push({ name: doc.name, driveFileId: file.id });
        } catch (e) {
          // One file failing (a broken link on Verra's own side, a transient error) shouldn't lose the rest of this project's documents.
          filesUploaded.push({ name: doc.name, driveFileId: "" });
        }
      }
      results.push({ verraProjectId, filesUploaded: filesUploaded.filter((f) => f.driveFileId) });
    } catch (e) {
      results.push({ verraProjectId, filesUploaded: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  await audit(ctx, "download_related_pdds", { type: "project", id: input.projectId }, {
    verraProjectIds: input.verraProjectIds,
    totalFilesUploaded: results.reduce((n, r) => n + r.filesUploaded.length, 0),
  });

  return ok({
    relatedPddsFolderId: relatedFolderId,
    relatedPddsFolderUrl: `https://drive.google.com/drive/folders/${relatedFolderId}`,
    projects: results,
  });
}
