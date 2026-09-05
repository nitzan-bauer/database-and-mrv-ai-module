import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { verifyDriveFolder } from "../google/driveClient";

export interface LinkedAgentDriveFolder {
  agentId: string;
  driveFolderId: string;
  driveFolderName: string;
}

/**
 * Link an agent to its own personal Drive folder (Stage 10 of the agent
 * learning-layer plan) — the exact same pattern as linkFarmDriveFolder.ts
 * (migration 0032), reused rather than reinvented per Nitzan's own
 * decision. Never searches or guesses which folder belongs to which
 * agent — the person doing this already has the right folder open and
 * pastes its id.
 */
export async function linkAgentDriveFolder(
  ctx: ToolContext,
  input: { agentId: string; driveFolderId: string },
): Promise<ToolResult<LinkedAgentDriveFolder>> {
  const guard = requireDbMode("linkAgentDriveFolder");
  if (guard) return guard;

  const policy = await checkPolicy("link_agent_drive_folder", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("linkAgentDriveFolder: no Google Drive access token for this session — sign in with Drive access granted.");
  }
  if (!input.driveFolderId?.trim()) {
    return fail("linkAgentDriveFolder: driveFolderId is required — copy it from the folder's URL in Drive.");
  }

  const { query } = await import("../db");
  const agents = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.agents WHERE agent_id = $1`, [input.agentId]);
  if (Number(agents[0].n) === 0) return fail("linkAgentDriveFolder: no such agent.");

  const verified = await verifyDriveFolder(ctx.googleAccessToken, input.driveFolderId.trim());
  if (!verified.ok) return fail(`linkAgentDriveFolder: ${verified.error}`);

  await query(`UPDATE mrv.agents SET drive_folder_id = $1, updated_at = now() WHERE agent_id = $2`, [
    input.driveFolderId.trim(),
    input.agentId,
  ]);

  await audit(ctx, "link_agent_drive_folder", { type: "agent", id: input.agentId }, {
    driveFolderId: input.driveFolderId.trim(),
    driveFolderName: verified.name,
  });

  return ok({ agentId: input.agentId, driveFolderId: input.driveFolderId.trim(), driveFolderName: verified.name });
}
