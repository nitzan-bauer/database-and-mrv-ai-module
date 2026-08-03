import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { verifyDriveFolder } from "../google/driveClient";

export interface LinkedDriveFolder {
  farmId: string;
  driveFolderId: string;
  driveFolderName: string;
}

/**
 * Link a farm to the Google Drive folder that already holds its documents
 * — Jennifer's document_centralisation skill, step one.
 *
 * This never searches Drive or guesses which folder belongs to which farm.
 * The person doing this already has the right folder open (following the
 * existing convention: tree crops under fruit-plantations, open-field crops
 * under farming project E.Africa, each farm named "<farm>, <country>") and
 * copies its id from the URL. All this does is verify that id is real,
 * reachable, and actually a folder before trusting it for anything.
 */
export async function linkFarmDriveFolder(
  ctx: ToolContext,
  input: { farmId: string; driveFolderId: string },
): Promise<ToolResult<LinkedDriveFolder>> {
  const guard = requireDbMode("linkFarmDriveFolder");
  if (guard) return guard;

  const policy = await checkPolicy("link_farm_drive_folder", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail(
      "linkFarmDriveFolder: no Google Drive access token for this session — sign in with Drive access granted.",
    );
  }
  if (!input.driveFolderId?.trim()) {
    return fail("linkFarmDriveFolder: driveFolderId is required — copy it from the folder's URL in Drive.");
  }

  const { query } = await import("../db");
  const farms = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.farms WHERE farm_id = $1`, [
    input.farmId,
  ]);
  if (Number(farms[0].n) === 0) return fail("linkFarmDriveFolder: no such farm.");

  const verified = await verifyDriveFolder(ctx.googleAccessToken, input.driveFolderId.trim());
  if (!verified.ok) return fail(`linkFarmDriveFolder: ${verified.error}`);

  await query(`UPDATE mrv.farms SET drive_folder_id = $1, updated_at = now() WHERE farm_id = $2`, [
    input.driveFolderId.trim(),
    input.farmId,
  ]);

  await audit(ctx, "link_farm_drive_folder", { type: "farm", id: input.farmId }, {
    driveFolderId: input.driveFolderId.trim(),
    driveFolderName: verified.name,
  });

  return ok({ farmId: input.farmId, driveFolderId: input.driveFolderId.trim(), driveFolderName: verified.name });
}

/**
 * Undo a link — for exactly the case that prompted building this: a folder
 * was linked to prove the integration works, or simply to the wrong farm,
 * and needs clearing before it misleads anyone browsing that farm's real
 * documents later. Clears the mapping only; nothing in Drive is touched.
 */
export async function unlinkFarmDriveFolder(
  ctx: ToolContext,
  input: { farmId: string },
): Promise<ToolResult<{ farmId: string }>> {
  const guard = requireDbMode("unlinkFarmDriveFolder");
  if (guard) return guard;

  const policy = await checkPolicy("unlink_farm_drive_folder", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");
  const farms = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.farms WHERE farm_id = $1`, [
    input.farmId,
  ]);
  if (Number(farms[0].n) === 0) return fail("unlinkFarmDriveFolder: no such farm.");

  await query(`UPDATE mrv.farms SET drive_folder_id = NULL, updated_at = now() WHERE farm_id = $1`, [
    input.farmId,
  ]);

  await audit(ctx, "unlink_farm_drive_folder", { type: "farm", id: input.farmId }, {});

  return ok({ farmId: input.farmId });
}
