import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_drive_sorting_round";

const SOURCE_KEYS = ["claude", "carbonature", "downloads"] as const;
const AGENT_IDS = ["dave", "jennifer", "john", "rebeka", "ron"] as const;

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
  "You are given a file's name and type only, not its content. Respond with a comma-separated list of agent ids " +
  "from {dave, jennifer, john, rebeka, ron} it belongs in, or exactly NONE if it should be excluded. Nothing else.";

interface ClassifiedFile {
  fileId: string;
  fileName: string;
  agentIds: string[];
  excluded: boolean;
}

async function classifyFile(fileName: string, mimeType: string): Promise<string[]> {
  const { getConfiguredProvider } = await import("../provider");
  const provider = await getConfiguredProvider();
  const resp = await provider.complete({
    system: CLASSIFY_SYSTEM_PROMPT,
    userMessage: `File: "${fileName}" (${mimeType})`,
    tools: [],
    maxTokens: 64,
  });
  const text = resp.kind === "text" ? resp.text.trim().toUpperCase() : "NONE";
  if (text === "NONE" || !text) return [];
  return AGENT_IDS.filter((id) => text.includes(id.toUpperCase()));
}

export async function runJohnDriveSortingRound(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listDriveFolderFiles, createDriveShortcut } = await import("../../google/driveClient");
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

  for (const source of sources) {
    let files;
    try {
      files = await listDriveFolderFiles(ctx.googleAccessToken, source.drive_folder_id);
    } catch (e) {
      paragraphs.push(`Could not read "${source.drive_folder_name}" (${source.source_key}): ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    for (const file of files) {
      scanned++;
      const already = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.drive_routing_log WHERE file_id = $1`, [file.id]);
      if (Number(already[0].n) > 0) continue; // already classified in an earlier round

      const agentIds = await classifyFile(file.name, file.mimeType);
      classified.push({ fileId: file.id, fileName: file.name, agentIds, excluded: agentIds.length === 0 });

      for (const agentId of agentIds) {
        const folderId = folderByAgent.get(agentId);
        if (!folderId) continue; // that agent has no linked folder yet — nothing to route into
        try {
          await createDriveShortcut(ctx.googleAccessToken, file.id, file.name, folderId);
          routed++;
        } catch (e) {
          paragraphs.push(`Could not create a shortcut for "${file.name}" in ${agentId}'s folder: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (agentIds.length === 0) excluded++;

      await query(
        `INSERT INTO mrv.drive_routing_log (file_id, file_name, agent_ids, excluded) VALUES ($1, $2, $3, $4)
         ON CONFLICT (file_id) DO NOTHING`,
        [file.id, file.name, agentIds, agentIds.length === 0],
      );
    }
  }

  const newlyClassified = classified.length;
  paragraphs.unshift(
    `Scanned ${scanned} file(s) across ${sources.length} source folder(s); ${newlyClassified} new since the last round ` +
      `(${routed} shortcut(s) created, ${excluded} excluded as internal planning material).`,
  );
  for (const c of classified.filter((c) => !c.excluded)) {
    paragraphs.push(`- "${c.fileName}" -> ${c.agentIds.join(", ")}`);
  }
  const missingFolders = AGENT_IDS.filter((id) => !folderByAgent.has(id));
  if (missingFolders.length) {
    paragraphs.push(`Not yet linked to a Drive folder, so nothing can be routed to them yet: ${missingFolders.join(", ")}.`);
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    agentId: "john",
    domain: "mrv",
    subject: `Drive sorting round — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "drive_sorting_round",
    sendEmail: newlyClassified > 0,
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${scanned} scanned, ${newlyClassified} new, ${routed} routed.)` };
}
