import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

/**
 * Stage 10.3 of the agent learning-layer plan: right after John's
 * biweekly sorting round (10.2, staggered a day later — see the seed
 * migration's own comment on why a once-daily cron can't do same-run
 * sequencing), each agent goes into its own Drive folder and learns from
 * whatever landed there. This is a new SOURCE feeding the memory/lesson
 * pipeline Stages 1-7 already built — no new memory mechanism, just a
 * real document trigger for it.
 *
 * Google Docs are read via a real text export; a non-Doc file (an
 * uploaded PDF/docx) is noted by name/type only in this pass — reading
 * those would need a PDF-parsing dependency this stage doesn't add.
 */

const DIGEST_SYSTEM_PROMPT =
  "You are {AGENT}, a CarboNature MRV agent. You've just read a real document from your own reference folder. " +
  "Extract what's actually worth remembering for your own work — a specific fact, figure, methodology detail, " +
  "or recommendation the document states. If it's genuinely not relevant to your work, say so plainly. 2-4 " +
  "sentences, plain prose. Never invent something the document doesn't actually say.";

const REVIEW_SYSTEM_PROMPT =
  "You are {AGENT}. You just finished reviewing every new document in your reference folder this round. Extract " +
  "one durable lesson from this round's material — a specific, concrete thing you should apply going forward. " +
  "If there is genuinely nothing worth remembering, respond with exactly: NOTHING.";

async function digestAgentDriveFolder(ctx: ToolContext, agentId: string, taskKey: string): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listDriveFolderFiles, exportGoogleDocAsText } = await import("../../google/driveClient");
  const { getConfiguredProvider } = await import("../provider");
  const { recordAgentMemory } = await import("../../tools/recordAgentMemory");
  const { recordLesson } = await import("../lessonMemory");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const paragraphs: string[] = [];

  if (!ctx.googleAccessToken) {
    return { ok: false, detail: "No Google access token this run — cannot read Drive." };
  }

  const agents = await query<{ drive_folder_id: string | null }>(`SELECT drive_folder_id FROM mrv.agents WHERE agent_id = $1`, [agentId]);
  if (!agents.length || !agents[0].drive_folder_id) {
    paragraphs.push("No Drive folder linked yet — link one with link_agent_drive_folder before this round can read anything.");
    const outcome = await finishScheduledTask(ctx, {
      taskKey,
      projectId: TARGET_PROJECT_ID,
      agentId,
      domain: agentId === "jennifer" || agentId === "ron" ? "crm" : "mrv",
      subject: `Drive folder review — ${new Date().toISOString().slice(0, 10)}`,
      bodyParagraphs: paragraphs,
      memoryKind: "drive_digestion",
      sendEmail: false,
    });
    return { ok: outcome.ok, detail: outcome.detail };
  }

  const files = await listDriveFolderFiles(ctx.googleAccessToken, agents[0].drive_folder_id);
  const provider = await getConfiguredProvider();
  const domain = agentId === "jennifer" || agentId === "ron" ? "crm" : "mrv";

  let digested = 0;
  const digestNotes: string[] = [];

  for (const file of files) {
    const already = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.agent_drive_digested WHERE agent_id = $1 AND file_id = $2`,
      [agentId, file.id],
    );
    if (Number(already[0].n) > 0) continue;

    let content: string | null = null;
    if (file.mimeType === "application/vnd.google-apps.document") {
      try {
        content = (await exportGoogleDocAsText(ctx.googleAccessToken, file.id)).slice(0, 8000);
      } catch {
        content = null;
      }
    }

    const resp = await provider.complete({
      system: DIGEST_SYSTEM_PROMPT.replace("{AGENT}", agentId),
      userMessage: content
        ? `Document: "${file.name}"\n\n${content}`
        : `Document: "${file.name}" (${file.mimeType}) — content not readable in this pass, name/type only.`,
      tools: [],
      maxTokens: 512,
    });
    const note = resp.kind === "text" ? resp.text.trim() : null;
    if (note) {
      await recordAgentMemory(ctx, {
        projectId: TARGET_PROJECT_ID,
        kind: "drive_note",
        domain,
        content: `From "${file.name}": ${note}`,
        metadata: { agentId, fileId: file.id, fileName: file.name },
      });
      digestNotes.push(`"${file.name}": ${note}`);
      digested++;
    }

    await query(
      `INSERT INTO mrv.agent_drive_digested (agent_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [agentId, file.id],
    );
  }

  paragraphs.push(`Reviewed ${digested} new document(s) in this round out of ${files.length} in the folder.`);
  paragraphs.push(...digestNotes);

  // Explicit review + lesson extraction at the end of the round — Nitzan's
  // own correction to the original plan: not just passive reading, a real
  // REVIEW step, through the same generic finding -> lesson trigger
  // (Stage 4), not a separate mechanism.
  if (digested > 0) {
    const resp = await provider.complete({
      system: REVIEW_SYSTEM_PROMPT.replace("{AGENT}", agentId),
      userMessage: digestNotes.join("\n"),
      tools: [],
      maxTokens: 256,
    });
    const lesson = resp.kind === "text" ? resp.text.trim() : "";
    if (lesson && lesson.toUpperCase() !== "NOTHING") {
      await recordLesson(ctx, {
        agentId,
        actionName: taskKey,
        projectId: TARGET_PROJECT_ID,
        domain,
        outcomeSummary: `Reviewed ${digested} new document(s) this round. ${lesson}`,
      });
    }
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey,
    projectId: TARGET_PROJECT_ID,
    agentId,
    domain,
    subject: `Drive folder review — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "drive_digestion",
    sendEmail: digested > 0,
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${digested}/${files.length} digested.)` };
}

export const DAVE_TASK_KEY = "dave_drive_digestion";
export const JENNIFER_TASK_KEY = "jennifer_drive_digestion";
export const JOHN_TASK_KEY = "john_drive_digestion";
export const REBEKA_TASK_KEY = "rebeka_drive_digestion";
export const RON_TASK_KEY = "ron_drive_digestion";

export const runDaveDriveDigestion = (ctx: ToolContext) => digestAgentDriveFolder(ctx, "dave", DAVE_TASK_KEY);
export const runJenniferDriveDigestion = (ctx: ToolContext) => digestAgentDriveFolder(ctx, "jennifer", JENNIFER_TASK_KEY);
export const runJohnDriveDigestion = (ctx: ToolContext) => digestAgentDriveFolder(ctx, "john", JOHN_TASK_KEY);
export const runRebekaDriveDigestion = (ctx: ToolContext) => digestAgentDriveFolder(ctx, "rebeka", REBEKA_TASK_KEY);
export const runRonDriveDigestion = (ctx: ToolContext) => digestAgentDriveFolder(ctx, "ron", RON_TASK_KEY);
