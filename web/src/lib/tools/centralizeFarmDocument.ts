import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { uploadFileToDriveFolder, type DriveFile } from "../google/driveClient";
import { buildFarmKml } from "../kml/buildFarmKml";
import { createZip } from "../kml/zipWriter";

export type CentralizeSource =
  | { type: "kmz" }
  | { type: "pdd_draft"; draftId: string }
  | { type: "custom"; fileName: string; mimeType: string; contentBase64: string };

export interface CentralizedDocument {
  farmId: string;
  driveFolderId: string;
  file: DriveFile;
}

/**
 * Push one already-real document into a farm's linked Drive folder —
 * Jennifer's document_centralisation skill, the write side.
 *
 * Deliberately narrow: this does not accept arbitrary generated content
 * from a model. "kmz" re-derives the farm's own boundary export
 * (exportPlotsKmz's own logic, so the file in Drive can never disagree
 * with the one downloaded from Compliance); "pdd_draft" uploads a draft
 * that generatePddDraft already produced and stored, verified to belong
 * to this farm's own project; "custom" is for a file a person already has
 * in hand (e.g. a signed registration PDF), never authored here.
 */
export async function centralizeFarmDocument(
  ctx: ToolContext,
  input: { farmId: string; source: CentralizeSource },
): Promise<ToolResult<CentralizedDocument>> {
  const guard = requireDbMode("centralizeFarmDocument");
  if (guard) return guard;

  const policy = await checkPolicy("centralize_farm_document", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("centralizeFarmDocument: no Google Drive access token for this session.");
  }

  const { query } = await import("../db");
  const farms = await query<{ name: string; project_id: string; drive_folder_id: string | null }>(
    `SELECT name, project_id, drive_folder_id FROM mrv.farms WHERE farm_id = $1`,
    [input.farmId],
  );
  if (!farms.length) return fail("centralizeFarmDocument: no such farm.");
  const farm = farms[0];
  if (!farm.drive_folder_id) {
    return fail("centralizeFarmDocument: this farm has no linked Drive folder yet — link one first.");
  }

  let fileName: string;
  let mimeType: string;
  let content: Buffer;

  if (input.source.type === "kmz") {
    const built = await buildFarmKml(query, input.farmId);
    if (!built.ok) return fail(`centralizeFarmDocument: ${built.error}`);
    content = createZip([{ name: "doc.kml", data: Buffer.from(built.data.kml, "utf8") }]);
    fileName = `${farm.name.replace(/[^a-z0-9]+/gi, "_")}.kmz`;
    mimeType = "application/vnd.google-earth.kmz";
  } else if (input.source.type === "pdd_draft") {
    const drafts = await query<{ content: string; template_name: string; template_version: string; project_id: string }>(
      `SELECT d.content, t.name AS template_name, t.version AS template_version, d.project_id
         FROM mrv.pdd_drafts d JOIN mrv.pdd_templates t ON t.template_id = d.template_id
        WHERE d.draft_id = $1`,
      [input.source.draftId],
    );
    if (!drafts.length) return fail("centralizeFarmDocument: no such PDD draft.");
    if (drafts[0].project_id !== farm.project_id) {
      return fail("centralizeFarmDocument: that draft belongs to a different project than this farm.");
    }
    content = Buffer.from(drafts[0].content, "utf8");
    fileName = `${drafts[0].template_name} ${drafts[0].template_version} draft.md`.replace(/\//g, "-");
    mimeType = "text/markdown";
  } else {
    if (!input.source.fileName?.trim()) return fail("centralizeFarmDocument: fileName is required.");
    if (!input.source.contentBase64?.trim()) return fail("centralizeFarmDocument: contentBase64 is required.");
    try {
      content = Buffer.from(input.source.contentBase64, "base64");
    } catch {
      return fail("centralizeFarmDocument: contentBase64 is not valid base64.");
    }
    fileName = input.source.fileName;
    mimeType = input.source.mimeType || "application/octet-stream";
  }

  const file = await uploadFileToDriveFolder(ctx.googleAccessToken, farm.drive_folder_id, fileName, mimeType, content);

  await audit(ctx, "centralize_farm_document", { type: "farm", id: input.farmId }, {
    driveFolderId: farm.drive_folder_id,
    sourceType: input.source.type,
    fileName,
    fileId: file.id,
    fileSizeBytes: content.length,
  });

  return ok({ farmId: input.farmId, driveFolderId: farm.drive_folder_id, file });
}
