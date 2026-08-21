import "server-only";
import { createDriveFolder } from "./driveClient";

/**
 * The project's own Drive folder — created once, reused after. Both the
 * PDD Google Doc (syncPddGoogleDoc) and the PDD Readiness Report belong
 * inside it, side by side, rather than scattered across Drive root.
 *
 * Four different PDD tools (syncPddGoogleDoc, compileEligibilityEvidencePack,
 * downloadRelatedPdds, ingestRelatedPddPrecedents) all call this for the
 * same project, sometimes close together. The old SELECT-then-create-
 * then-UPDATE had no guard against two of them running concurrently: both
 * could read a null drive_folder_id, both call the real Drive API and
 * create a folder, and only the second UPDATE's folder id survives in the
 * DB — the first call's folder becomes an orphaned duplicate on Drive
 * that nothing ever references again. pg_advisory_xact_lock serializes
 * concurrent callers for the same project onto one at a time (keyed by
 * projectId) and releases itself automatically at COMMIT/ROLLBACK — no
 * separate unlock call to forget, unlike session-scoped advisory locks.
 */
export async function ensureProjectDriveFolder(
  accessToken: string,
  projectId: string,
  projectName: string,
): Promise<string> {
  const { withTransaction } = await import("../db");
  return withTransaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [projectId]);

    const rows = await tx.query<{ drive_folder_id: string | null }>(
      `SELECT drive_folder_id FROM mrv.projects WHERE project_id = $1`,
      [projectId],
    );
    const existing = rows.rows[0]?.drive_folder_id;
    if (existing) return existing;

    const folder = await createDriveFolder(accessToken, projectName);
    await tx.query(`UPDATE mrv.projects SET drive_folder_id = $2 WHERE project_id = $1`, [projectId, folder.id]);
    return folder.id;
  });
}
