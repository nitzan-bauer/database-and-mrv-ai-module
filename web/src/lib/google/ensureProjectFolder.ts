import "server-only";
import { createDriveFolder } from "./driveClient";

/**
 * The project's own Drive folder — created once, reused after. Both the
 * PDD Google Doc (syncPddGoogleDoc) and the PDD Readiness Report belong
 * inside it, side by side, rather than scattered across Drive root.
 */
export async function ensureProjectDriveFolder(
  query: <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>,
  accessToken: string,
  projectId: string,
  projectName: string,
): Promise<string> {
  const rows = await query<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM mrv.projects WHERE project_id = $1`,
    [projectId],
  );
  const existing = rows[0]?.drive_folder_id;
  if (existing) return existing;

  const folder = await createDriveFolder(accessToken, projectName);
  await query(`UPDATE mrv.projects SET drive_folder_id = $2 WHERE project_id = $1`, [projectId, folder.id]);
  return folder.id;
}
