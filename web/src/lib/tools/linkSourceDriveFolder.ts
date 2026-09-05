import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { verifyDriveFolder } from "../google/driveClient";

export type DriveSourceKey = "claude" | "carbonature" | "downloads";
const SOURCE_KEYS: DriveSourceKey[] = ["claude", "carbonature", "downloads"];

export interface LinkedSourceFolder {
  sourceKey: DriveSourceKey;
  driveFolderId: string;
  driveFolderName: string;
}

/**
 * Link one of the 3 real source folders (CLAUDE, CARBONATURE, DOWNLOADS)
 * John's biweekly sorting round reads from (Stage 10). Same "paste the
 * id, we verify it" pattern as every other Drive link here — nothing
 * searches Drive by folder name.
 */
export async function linkSourceDriveFolder(
  ctx: ToolContext,
  input: { sourceKey: DriveSourceKey; driveFolderId: string },
): Promise<ToolResult<LinkedSourceFolder>> {
  const guard = requireDbMode("linkSourceDriveFolder");
  if (guard) return guard;

  const policy = await checkPolicy("link_source_drive_folder", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("linkSourceDriveFolder: no Google Drive access token for this session — sign in with Drive access granted.");
  }
  if (!SOURCE_KEYS.includes(input.sourceKey)) {
    return fail(`linkSourceDriveFolder: sourceKey must be one of ${SOURCE_KEYS.join(", ")}.`);
  }
  if (!input.driveFolderId?.trim()) {
    return fail("linkSourceDriveFolder: driveFolderId is required — copy it from the folder's URL in Drive.");
  }

  const verified = await verifyDriveFolder(ctx.googleAccessToken, input.driveFolderId.trim());
  if (!verified.ok) return fail(`linkSourceDriveFolder: ${verified.error}`);

  const { query } = await import("../db");
  await query(
    `INSERT INTO mrv.drive_source_folders (source_key, drive_folder_id, drive_folder_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (source_key) DO UPDATE SET
       drive_folder_id = excluded.drive_folder_id,
       drive_folder_name = excluded.drive_folder_name,
       linked_at = now()`,
    [input.sourceKey, input.driveFolderId.trim(), verified.name],
  );

  await audit(ctx, "link_source_drive_folder", { type: "drive_source_folder", id: input.sourceKey }, {
    driveFolderId: input.driveFolderId.trim(),
    driveFolderName: verified.name,
  });

  return ok({ sourceKey: input.sourceKey, driveFolderId: input.driveFolderId.trim(), driveFolderName: verified.name });
}
