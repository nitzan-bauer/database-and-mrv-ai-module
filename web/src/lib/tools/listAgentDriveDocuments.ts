import "server-only";
import { checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { listDriveFolderFiles, type DriveFile } from "../google/driveClient";

/** The real, current contents of an agent's own Drive folder — read-only, mirrors listFarmDriveDocuments.ts. */
export async function listAgentDriveDocuments(
  ctx: ToolContext,
  input: { agentId: string },
): Promise<ToolResult<DriveFile[]>> {
  const guard = requireDbMode("listAgentDriveDocuments");
  if (guard) return guard;

  const policy = await checkPolicy("list_agent_drive_documents", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("listAgentDriveDocuments: no Google Drive access token for this session.");
  }

  const { query } = await import("../db");
  const agents = await query<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM mrv.agents WHERE agent_id = $1`,
    [input.agentId],
  );
  if (!agents.length) return fail("listAgentDriveDocuments: no such agent.");
  if (!agents[0].drive_folder_id) {
    return fail("listAgentDriveDocuments: this agent has no linked Drive folder yet — link one first.");
  }

  const files = await listDriveFolderFiles(ctx.googleAccessToken, agents[0].drive_folder_id);
  return ok(files);
}
