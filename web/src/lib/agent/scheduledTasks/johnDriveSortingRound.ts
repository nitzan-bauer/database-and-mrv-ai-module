import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_drive_sorting_round";

const SOURCE_KEYS = ["claude", "carbonature", "downloads", "peer_reviews"] as const;
const AGENT_IDS = ["dave", "jennifer", "john", "rebeka", "ron"] as const;
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// Nitzan's own request (2026-09-10): the curated "Peer reviews" folder
// (real meta-analysis papers + John's own research-note summaries) is
// reviewed by exactly these three agents — already fully known, not
// something an LLM needs to classify per file the way claude/
// carbonature/downloads are (those are general-purpose folders whose
// content could belong to any agent).
const PEER_REVIEW_SOURCE_KEY = "peer_reviews";
const PEER_REVIEW_AGENT_IDS = ["dave", "rebeka", "john"] as const;

// Confirmed live 2026-09-07: the real source folders hold 138 direct
// children combined, and roughly half of those are subfolders (Drive's
// files.list only returns direct children, so this never recurses into
// them — but it was still classifying the folders themselves as if they
// were documents). One model call per file, sequentially, over that many
// items blew well past the cron route's original 45s per-handler
// timeout. Two fixes: skip folders entirely (this task routes documents,
// not directories), and classify a whole batch of files in a single
// model call instead of one round-trip per file. MAX_FILES_PER_RUN caps
// how many NEW files get classified in one invocation — same bounded,
// incremental-first-pass idiom as johnMemoryConsolidation.ts's
// MAX_MERGES_PER_RUN. mrv.drive_routing_log already makes leaving the
// rest for the next round correct: a file already logged is skipped.
// Raised from 25 to 60 now that the cron route gives 240s instead of
// 45s — classification is one batched model call regardless of count,
// so a bigger batch mostly costs prompt/response size, not more calls.
const MAX_FILES_PER_RUN = 60;

// Nitzan's own correction, 2026-09-07: an agent's folder should hold
// real documents it has actually sent him by email over time (reports,
// PDDs — anything produced because he asked for it), not only shortcuts
// to externally-sourced files. Bounded the same way as MAX_FILES_PER_RUN
// — a large backlog spreads across rounds rather than risking the
// per-handler timeout in one go. Raised from 15 to 30 alongside the 240s
// budget increase.
const MAX_EMAIL_DOCS_PER_RUN = 30;
const GMAIL_SEARCH_LIMIT = 20;

const CLASSIFY_SYSTEM_PROMPT =
  "You route real documents found in CarboNature's shared folders to the right AI agents' own personal Drive " +
  "folders, by responsibility. The agents and their real domains:\n" +
  "- dave: Monitoring & Verification — sampling, baseline sites, model runs, VVB findings, uncertainty.\n" +
  "- rebeka: PDD drafting — VM0042 methodology, additionality, eligible products/practices, precedent research.\n" +
  "- john: credit allocation, portfolio/pipeline reporting, market scans.\n" +
  "- jennifer: farmer/lead outreach, CRM hygiene, meeting scheduling.\n" +
  "- ron: sales, marketing, buyer/farmer funnels — marketing decks and presentations belong here.\n\n" +
  "A document can belong to MORE than one agent (e.g. a product-eligibility research brief fits both rebeka and " +
  "dave). Exclude entirely (empty result) any internal work-plan, prompt-engineering, specification, or " +
  "meta-planning document — those are for the human team, not agent domain knowledge, even if they mention an " +
  "agent by name.\n\n" +
  "You are given a numbered list of files (name and type only, not content). Respond with exactly one line per " +
  "file, in the same order, in the form `N: agent,agent` (ids from dave/jennifer/john/rebeka/ron) or `N: NONE` " +
  "if it should be excluded. Nothing else — no headers, no commentary.";

interface DriveFileLike {
  id: string;
  name: string;
  mimeType: string;
}

interface ClassifiedFile {
  fileId: string;
  fileName: string;
  agentIds: string[];
  excluded: boolean;
}

async function classifyFilesBatch(files: DriveFileLike[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!files.length) return result;

  const { getConfiguredProvider } = await import("../provider");
  const provider = await getConfiguredProvider();
  const listing = files.map((f, i) => `${i + 1}. "${f.name}" (${f.mimeType})`).join("\n");
  const resp = await provider.complete({
    system: CLASSIFY_SYSTEM_PROMPT,
    userMessage: listing,
    tools: [],
    maxTokens: 1024,
  });
  const text = resp.kind === "text" ? resp.text : "";
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s*[:.]\s*(.+)$/);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= files.length) continue;
    const value = m[2].trim().toUpperCase();
    const agentIds = value === "NONE" || !value ? [] : AGENT_IDS.filter((id) => value.includes(id.toUpperCase()));
    result.set(files[idx].id, agentIds);
  }
  return result;
}

/**
 * Real copies (not shortcuts — Nitzan's own choice) of every attachment
 * an agent has sent from its own alias, found by searching Nitzan's
 * mailbox for `from:<alias> has:attachment`. mrv.agent_email_document_log
 * is keyed by (gmail_id, attachment_filename) so a re-scan of the same
 * mailbox never re-uploads the same document twice.
 */
async function centralizeAgentEmailDocuments(
  ctx: ToolContext,
  folderByAgent: Map<string, string>,
  paragraphs: string[],
): Promise<number> {
  const { query } = await import("../../db");
  const { searchGmailMessages, listMessageAttachments, getMessageAttachmentData } = await import("../../google/gmailClient");
  const { uploadFileToDriveFolder } = await import("../../google/driveClient");
  const { agentSenderEmail } = await import("../agentEmailAliases");

  if (!ctx.googleAccessToken) return 0;

  let uploaded = 0;
  for (const agentId of AGENT_IDS) {
    if (uploaded >= MAX_EMAIL_DOCS_PER_RUN) break;
    const folderId = folderByAgent.get(agentId);
    if (!folderId) continue; // reported separately as a missing-folder note

    let messages;
    try {
      messages = await searchGmailMessages(ctx.googleAccessToken, `from:${agentSenderEmail(agentId)} has:attachment`, GMAIL_SEARCH_LIMIT);
    } catch (e) {
      paragraphs.push(`Could not search ${agentId}'s sent mail: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    for (const message of messages) {
      if (uploaded >= MAX_EMAIL_DOCS_PER_RUN) break;
      let attachments;
      try {
        attachments = await listMessageAttachments(ctx.googleAccessToken, message.gmailId);
      } catch (e) {
        paragraphs.push(`Could not read attachments on "${message.subject ?? message.gmailId}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      for (const att of attachments) {
        if (uploaded >= MAX_EMAIL_DOCS_PER_RUN) break;
        const already = await query<{ n: string }>(
          `SELECT count(*)::text n FROM mrv.agent_email_document_log WHERE gmail_id = $1 AND attachment_filename = $2`,
          [message.gmailId, att.filename],
        );
        if (Number(already[0].n) > 0) continue;

        try {
          const bytes = await getMessageAttachmentData(ctx.googleAccessToken, message.gmailId, att.attachmentId);
          const uploadedFile = await uploadFileToDriveFolder(ctx.googleAccessToken, folderId, att.filename, att.mimeType, bytes);
          await query(
            `INSERT INTO mrv.agent_email_document_log (gmail_id, attachment_filename, agent_id, drive_file_id)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [message.gmailId, att.filename, agentId, uploadedFile.id],
          );
          paragraphs.push(`- Centralized "${att.filename}" (from ${agentId}'s own sent mail, "${message.subject ?? "no subject"}") into ${agentId}'s folder.`);
          uploaded++;
        } catch (e) {
          paragraphs.push(`Could not centralize "${att.filename}" for ${agentId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  return uploaded;
}

export async function runJohnDriveSortingRound(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listDriveFolderFiles, copyDriveFile } = await import("../../google/driveClient");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const paragraphs: string[] = [];

  if (!ctx.googleAccessToken) {
    return { ok: false, detail: "No Google access token this run — cannot read Drive." };
  }

  const sources = await query<{ source_key: string; drive_folder_id: string; drive_folder_name: string }>(
    `SELECT source_key, drive_folder_id, drive_folder_name FROM mrv.drive_source_folders`,
  );
  if (!sources.length) {
    paragraphs.push(
      "No source folders linked yet (claude, carbonature, downloads) — nothing to scan. " +
        "Link them with link_source_drive_folder before this task can do anything.",
    );
    const outcome = await finishScheduledTask(ctx, {
      taskKey: TASK_KEY,
      projectId: TARGET_PROJECT_ID,
      agentId: "john",
      domain: "mrv",
      subject: `Drive sorting round — ${new Date().toISOString().slice(0, 10)}`,
      bodyParagraphs: paragraphs,
      memoryKind: "drive_sorting_round",
      sendEmail: false,
    });
    return { ok: outcome.ok, detail: outcome.detail };
  }

  const agentFolders = await query<{ agent_id: string; drive_folder_id: string | null }>(
    `SELECT agent_id, drive_folder_id FROM mrv.agents WHERE agent_id = ANY($1)`,
    [AGENT_IDS],
  );
  const folderByAgent = new Map(agentFolders.filter((a) => a.drive_folder_id).map((a) => [a.agent_id, a.drive_folder_id!]));

  let scanned = 0;
  let routed = 0;
  let excluded = 0;
  const classified: ClassifiedFile[] = [];
  const candidateFiles: DriveFileLike[] = [];
  const peerReviewFiles: DriveFileLike[] = [];

  for (const source of sources) {
    let files;
    try {
      files = await listDriveFolderFiles(ctx.googleAccessToken, source.drive_folder_id);
    } catch (e) {
      paragraphs.push(`Could not read "${source.drive_folder_name}" (${source.source_key}): ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    for (const file of files) {
      if (file.mimeType === FOLDER_MIME_TYPE) continue; // route documents, not directories
      scanned++;
      const already = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.drive_routing_log WHERE file_id = $1`, [file.id]);
      if (Number(already[0].n) > 0) continue; // already classified in an earlier round
      if (source.source_key === PEER_REVIEW_SOURCE_KEY) {
        peerReviewFiles.push(file);
      } else {
        candidateFiles.push(file);
      }
    }
  }

  const toClassify = candidateFiles.slice(0, MAX_FILES_PER_RUN);
  const deferredCount = candidateFiles.length - toClassify.length;

  const routingMap = await classifyFilesBatch(toClassify);
  for (const file of toClassify) {
    const agentIds = routingMap.get(file.id) ?? [];
    classified.push({ fileId: file.id, fileName: file.name, agentIds, excluded: agentIds.length === 0 });

    for (const agentId of agentIds) {
      const folderId = folderByAgent.get(agentId);
      if (!folderId) continue; // that agent has no linked folder yet — nothing to route into
      try {
        await copyDriveFile(ctx.googleAccessToken, file.id, folderId, file.name);
        routed++;
      } catch (e) {
        paragraphs.push(`Could not copy "${file.name}" into ${agentId}'s folder: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (agentIds.length === 0) excluded++;

    await query(
      `INSERT INTO mrv.drive_routing_log (file_id, file_name, agent_ids, excluded) VALUES ($1, $2, $3, $4)
       ON CONFLICT (file_id) DO NOTHING`,
      [file.id, file.name, agentIds, agentIds.length === 0],
    );
  }

  // Unconditional routing for the curated Peer reviews folder — no
  // classification call, the 3 target agents are already fully known.
  const toRoutePeerReview = peerReviewFiles.slice(0, MAX_FILES_PER_RUN);
  const peerReviewDeferredCount = peerReviewFiles.length - toRoutePeerReview.length;
  for (const file of toRoutePeerReview) {
    const agentIds: string[] = [...PEER_REVIEW_AGENT_IDS];
    classified.push({ fileId: file.id, fileName: file.name, agentIds, excluded: false });
    for (const agentId of agentIds) {
      const folderId = folderByAgent.get(agentId);
      if (!folderId) continue;
      try {
        await copyDriveFile(ctx.googleAccessToken, file.id, folderId, file.name);
        routed++;
      } catch (e) {
        paragraphs.push(`Could not copy "${file.name}" into ${agentId}'s folder: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await query(
      `INSERT INTO mrv.drive_routing_log (file_id, file_name, agent_ids, excluded) VALUES ($1, $2, $3, false)
       ON CONFLICT (file_id) DO NOTHING`,
      [file.id, file.name, agentIds],
    );
  }

  const newlyClassified = classified.length;
  paragraphs.unshift(
    `Scanned ${scanned} file(s) across ${sources.length} source folder(s); ${newlyClassified} new since the last round ` +
      `(${routed} real cop${routed === 1 ? "y" : "ies"} made, ${excluded} excluded as internal planning material).`,
  );
  if (deferredCount > 0) {
    paragraphs.push(
      `${deferredCount} more new file(s) queued for the next round — kept this round to ${MAX_FILES_PER_RUN} to stay inside the time budget.`,
    );
  }
  if (peerReviewDeferredCount > 0) {
    paragraphs.push(`${peerReviewDeferredCount} more new file(s) in Peer reviews queued for the next round.`);
  }
  for (const c of classified.filter((c) => !c.excluded)) {
    paragraphs.push(`- "${c.fileName}" -> ${c.agentIds.join(", ")}`);
  }
  const missingFolders = AGENT_IDS.filter((id) => !folderByAgent.has(id));
  if (missingFolders.length) {
    paragraphs.push(`Not yet linked to a Drive folder, so nothing can be routed to them yet: ${missingFolders.join(", ")}.`);
  }

  const emailDocsUploaded = await centralizeAgentEmailDocuments(ctx, folderByAgent, paragraphs);
  paragraphs.push(`Centralized ${emailDocsUploaded} real document(s) this round from agents' own sent mail.`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    agentId: "john",
    domain: "mrv",
    subject: `Drive sorting round — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "drive_sorting_round",
    sendEmail: newlyClassified > 0 || emailDocsUploaded > 0,
  });

  return {
    ok: outcome.ok,
    detail: `${outcome.detail} (${scanned} scanned, ${newlyClassified} new, ${routed} routed, ${emailDocsUploaded} email doc(s) centralized.)`,
  };
}
