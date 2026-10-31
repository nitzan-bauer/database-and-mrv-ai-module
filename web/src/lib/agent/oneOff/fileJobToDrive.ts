import "server-only";
import type { ToolContext } from "../../tools/context";
import type { Routing } from "./jobInput";
import type { OneOffJob } from "./jobStore";

/**
 * Puts everything about the task next to its PDF (which finishScheduledTask already uploaded):
 *   <the agent's folder>/One-off tasks/<topic>/<date — title>/{report.pdf, report.md, request.md, sources.md, attachments/*.txt}
 * and, when the answer is about a named farm that has its own Drive folder, a shortcut to that folder inside the farm's folder.
 * The agent's own *_drive_digestion round re-reads this folder later, which closes the learning loop.
 */
export async function fileJobToDrive(
  ctx: ToolContext,
  input: { job: OneOffJob; body: string; routing: Routing; folderPath: string[] },
): Promise<{ summary: string }> {
  const token = ctx.googleAccessToken;
  if (!token) return { summary: "no Google access token — nothing filed" };

  const { query } = await import("../../db");
  const { ensureSubfolder, uploadFileToDriveFolder, createDriveShortcut } = await import("../../google/driveClient");
  const { job, routing } = input;

  const agentRows = await query<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM mrv.agents WHERE agent_id = $1`,
    [job.agentId],
  );
  const root = agentRows[0]?.drive_folder_id;
  if (!root) return { summary: `${job.agentId} has no linked Drive folder` };

  let folderId = root;
  for (const name of input.folderPath) folderId = await ensureSubfolder(token, folderId, name);

  const text = (name: string, content: string) =>
    uploadFileToDriveFolder(token, folderId, name, "text/markdown", Buffer.from(content, "utf8"));

  await text("request.md", `# Request\n\n${job.prompt}\n\nRequested by: ${job.requestedBy}\nDate: ${job.createdAt}\n`);
  await text("report.md", `# Report\n\n${input.body}\n`);
  await text(
    "sources.md",
    `# Sources\n\n${job.links.map((l) => `- ${l}`).join("\n") || "(no links)"}\n\n` +
      (job.chromeDomains.length ? `## Signed-in sites allowed\n\n${job.chromeDomains.map((d) => `- ${d}`).join("\n")}\n\n` : "") +
      `## Attached files\n\n` +
      (job.attachments.map((a) => `- ${a.name}${a.truncated ? " (truncated)" : ""}`).join("\n") || "(none)") +
      "\n",
  );

  if (job.attachments.length) {
    const attFolder = await ensureSubfolder(token, folderId, "attachments");
    for (const a of job.attachments) {
      await uploadFileToDriveFolder(token, attFolder, `${a.name}.txt`, "text/plain", Buffer.from(a.text, "utf8"));
    }
  }

  let farmNote = "";
  if (routing.farm) {
    const farms = await query<{ drive_folder_id: string | null }>(
      `SELECT drive_folder_id FROM mrv.farms WHERE lower(name) = lower($1)`,
      [routing.farm],
    );
    if (farms.length === 1 && farms[0].drive_folder_id) {
      await createDriveShortcut(token, folderId, input.folderPath[2], farms[0].drive_folder_id);
      farmNote = `, shortcut in ${routing.farm}'s folder`;
    }
  }
  return { summary: `${input.folderPath.join(" / ")}${farmNote}` };
}
