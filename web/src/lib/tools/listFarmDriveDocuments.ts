import "server-only";
import { checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { listDriveFolderFiles, type DriveFile } from "../google/driveClient";

/**
 * The real, current contents of a farm's linked Drive folder — read-only,
 * so this is never audited as a write; nothing changes by looking.
 */
export async function listFarmDriveDocuments(
  ctx: ToolContext,
  input: { farmId: string },
): Promise<ToolResult<DriveFile[]>> {
  const guard = requireDbMode("listFarmDriveDocuments");
  if (guard) return guard;

  const policy = await checkPolicy("list_farm_drive_documents", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("listFarmDriveDocuments: no Google Drive access token for this session.");
  }

  const { query } = await import("../db");
  const farms = await query<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM mrv.farms WHERE farm_id = $1`,
    [input.farmId],
  );
  if (!farms.length) return fail("listFarmDriveDocuments: no such farm.");
  if (!farms[0].drive_folder_id) {
    return fail("listFarmDriveDocuments: this farm has no linked Drive folder yet — link one first.");
  }

  const files = await listDriveFolderFiles(ctx.googleAccessToken, farms[0].drive_folder_id);
  return ok(files);
}
