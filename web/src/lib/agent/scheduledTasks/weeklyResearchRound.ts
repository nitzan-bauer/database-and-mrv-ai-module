import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_weekly_research_round";

/**
 * Weekly research round (Nitzan's own spec, live this session): a
 * research sweep including the RELATED PROJECT process, updating the PDD
 * where there's something to update, then the report/memory/DB/email
 * close shared by all 5 tasks (finishScheduledTask).
 *
 * "RELATED PROJECT process" is exactly the existing download_related_pdds
 * + ingest_related_pdd_precedents pair — this handler's only real
 * decision is which Verra projects count as "related" for an
 * unattended run: the up-to-3 newest VM0042 registry entries
 * search_verra_registry hasn't seen before, capped so one week's
 * automated sweep can't run away downloading dozens of projects' files.
 */
export async function runWeeklyResearchRound(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { searchVerraRegistry } = await import("../../tools/searchVerraRegistry");
  const { downloadRelatedPdds } = await import("../../tools/downloadRelatedPdds");
  const { ingestRelatedPddPrecedents } = await import("../../tools/ingestRelatedPddPrecedents");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { listPddSectionStatus } = await import("../../pdd/sectionStatus");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const registrySearch = await searchVerraRegistry(ctx, { methodology: "VM0042", limit: 20 });
  if (!registrySearch.ok) {
    return { ok: false, detail: `weekly research round: search_verra_registry failed — ${registrySearch.error}` };
  }

  const newEntries = registrySearch.data.entries.filter((e) => e.isNew).slice(0, 3);
  const paragraphs: string[] = [];
  paragraphs.push(
    `Weekly VM0042 registry sweep: ${registrySearch.data.totalMatching} projects matching, ` +
      `${registrySearch.data.newSinceLastCheck} new since the last check.`,
  );

  let ingestedCount = 0;
  if (newEntries.length) {
    paragraphs.push(
      `Related-project process run for ${newEntries.length} newly-seen project(s): ` +
        newEntries.map((e) => `"${e.projectName}" (Verra #${e.verraProjectId}, ${e.status})`).join("; "),
    );

    const downloadResult = await downloadRelatedPdds(ctx, {
      projectId: TARGET_PROJECT_ID,
      verraProjectIds: newEntries.map((e) => String(e.verraProjectId)),
    });
    if (downloadResult.ok) {
      const filesTotal = downloadResult.data.projects.reduce((n, p) => n + p.filesUploaded.length, 0);
      paragraphs.push(`Downloaded ${filesTotal} related document(s) into Drive's RELATED PDDS folder.`);

      const ingestResult = await ingestRelatedPddPrecedents(ctx, { projectId: TARGET_PROJECT_ID });
      if (ingestResult.ok) {
        ingestedCount = ingestResult.data.indexed;
        paragraphs.push(`Indexed ${ingestedCount} of those file(s) into the precedent search corpus.`);
      } else {
        paragraphs.push(`Could not index the downloaded files into the precedent corpus: ${ingestResult.error}`);
      }
    } else {
      paragraphs.push(`Could not download the related PDDs: ${downloadResult.error}`);
    }
  } else {
    paragraphs.push("No new VM0042 registry entries since the last weekly sweep — nothing new to bring in as a related project.");
  }

  // Redraft any chapter that has real content to write, so a newly
  // ingested precedent (or anything else pending) actually reaches the
  // PDD rather than sitting only in the search corpus.
  let redraftedCount = 0;
  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  if (sectionStatus) {
    const chapterTitles = sectionStatus.rows.filter((r) => r.sectionLevel === 1).map((r) => r.sectionTitle);
    if (chapterTitles.length) {
      const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles });
      if (draftResult.ok) {
        redraftedCount = draftResult.data.sections.filter((s) => s.outcome === "drafted").length;
        if (redraftedCount) {
          paragraphs.push(
            `Drafted ${redraftedCount} PDD section(s): ` +
              draftResult.data.sections
                .filter((s) => s.outcome === "drafted")
                .map((s) => s.sectionTitle)
                .join("; "),
          );
        } else {
          paragraphs.push("No PDD sections had new guidance or direction to draft against this week.");
        }
      } else {
        paragraphs.push(`Could not run the drafting pass: ${draftResult.error}`);
      }
    }
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Weekly research round — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "weekly_research_round",
  });

  return {
    ok: outcome.ok,
    detail: `${outcome.detail} (${newEntries.length} related project(s), ${ingestedCount} precedent(s) indexed, ${redraftedCount} section(s) drafted.)`,
  };
}
