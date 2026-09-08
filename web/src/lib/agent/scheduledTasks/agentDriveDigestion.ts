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
 * Google Docs are read via a real text export; real PDFs and .docx files
 * are read via this repo's own existing extractPdfText (lib/ingest/pdf.ts)
 * and readParagraphs (lib/ingest/docx.ts) — both already built and used
 * elsewhere (PDD-precedent research), just never wired into this task
 * until Nitzan flagged that every one of Dave's digested notes was
 * coming back "not readable." No new dependency or Google scope needed:
 * downloadDriveFile already uses the same Drive OAuth grant as every
 * other read here. A legacy .doc (pre-2007 binary format) still isn't
 * read — readParagraphs needs a real .docx zip — but that format never
 * showed up in the real source folders scanned so far.
 *
 * Folders (real ones, or a shortcut/copy pointing at one — leftover
 * routing artifacts from before John's sorting round started skipping
 * folders) are excluded outright rather than digested as if they were a
 * document with no content.
 *
 * Every file an agent sees here may be a shortcut John's sorting round
 * created — its own `mimeType` is always the shortcut type, never the
 * real target's. `listDriveFolderFiles` requests `shortcutDetails`, so
 * `targetMimeType`/`targetId` resolve through it before any content
 * decision is made.
 */

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Confirmed live 2026-09-07: adding real PDF/docx download+parse on top
// of the per-file model call pushed a normal-sized backlog (Jennifer's
// folder, that round) past the cron route's 45s per-handler timeout —
// this loop previously had no per-run cap at all, unlike every other
// bounded batch job in this codebase (MAX_FILES_PER_RUN,
// MAX_EMAIL_DOCS_PER_RUN, MAX_MERGES_PER_RUN). A folder-skip is free and
// doesn't count against this; only an actual content-resolution +
// model-call attempt does. The rest of a large backlog spreads across
// this task's own biweekly rounds — mrv.agent_drive_digested already
// makes that correct, exactly like every other capped job here.
const MAX_DOCS_PER_RUN = 8;

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
  const { listDriveFolderFiles, exportGoogleDocAsText, downloadDriveFile } = await import("../../google/driveClient");
  const { extractPdfText } = await import("../../ingest/pdf");
  const { readParagraphs } = await import("../../ingest/docx");
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
  let processed = 0;
  let deferredCount = 0;
  const digestNotes: string[] = [];

  for (const file of files) {
    const already = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.agent_drive_digested WHERE agent_id = $1 AND file_id = $2`,
      [agentId, file.id],
    );
    if (Number(already[0].n) > 0) continue;

    const isShortcut = file.mimeType === "application/vnd.google-apps.shortcut";
    const effectiveMimeType = isShortcut ? file.shortcutDetails?.targetMimeType : file.mimeType;
    const readableFileId = isShortcut ? file.shortcutDetails?.targetId : file.id;

    if (effectiveMimeType === FOLDER_MIME_TYPE) {
      // A folder routed here by mistake (pre-dates John's sorting round
      // skipping folders) — nothing to digest, and not worth a "couldn't
      // read this" note either. Still marked digested so it stops
      // reappearing every round.
      await query(
        `INSERT INTO mrv.agent_drive_digested (agent_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [agentId, file.id],
      );
      continue;
    }

    if (processed >= MAX_DOCS_PER_RUN) {
      deferredCount++;
      continue; // not marked digested — genuinely picked up next round, not skipped forever
    }
    processed++;

    let content: string | null = null;
    if (effectiveMimeType === GOOGLE_DOC_MIME_TYPE && readableFileId) {
      try {
        content = (await exportGoogleDocAsText(ctx.googleAccessToken, readableFileId)).slice(0, 8000);
      } catch {
        content = null;
      }
    } else if (effectiveMimeType === PDF_MIME_TYPE && readableFileId) {
      try {
        const bytes = await downloadDriveFile(ctx.googleAccessToken, readableFileId);
        content = (await extractPdfText(bytes)).slice(0, 8000);
      } catch {
        content = null;
      }
    } else if (effectiveMimeType === DOCX_MIME_TYPE && readableFileId) {
      try {
        const bytes = await downloadDriveFile(ctx.googleAccessToken, readableFileId);
        content = readParagraphs(bytes).map((p) => p.text).join("\n").slice(0, 8000);
      } catch {
        content = null;
      }
    }

    const resp = await provider.complete({
      system: DIGEST_SYSTEM_PROMPT.replace("{AGENT}", agentId),
      userMessage: content
        ? `Document: "${file.name}"\n\n${content}`
        : `Document: "${file.name}" (${effectiveMimeType ?? file.mimeType}) — content not readable in this pass, name/type only.`,
      tools: [],
      maxTokens: 512,
    });
    const note = resp.kind === "text" ? resp.text.trim() : null;
    if (note) {
      // recordAgentMemory returns a {ok, error} ToolResult rather than
      // throwing — confirmed live 2026-09-07: an unchecked call here let
      // a real embedding failure pass completely silently, with the file
      // still counted as "digested" and no memory actually written.
      const recorded = await recordAgentMemory(ctx, {
        projectId: TARGET_PROJECT_ID,
        kind: "drive_note",
        domain,
        content: `From "${file.name}": ${note}`,
        metadata: { agentId, fileId: file.id, fileName: file.name },
      });
      if (recorded.ok) {
        digestNotes.push(`"${file.name}": ${note}`);
        digested++;
      } else {
        paragraphs.push(`Could not save the note on "${file.name}": ${recorded.error}`);
      }
    }

    await query(
      `INSERT INTO mrv.agent_drive_digested (agent_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [agentId, file.id],
    );
  }

  paragraphs.push(`Reviewed ${digested} new document(s) in this round out of ${files.length} in the folder.`);
  if (deferredCount > 0) {
    paragraphs.push(`${deferredCount} more new document(s) queued for the next round — kept this round to ${MAX_DOCS_PER_RUN} to stay inside the time budget.`);
  }
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
