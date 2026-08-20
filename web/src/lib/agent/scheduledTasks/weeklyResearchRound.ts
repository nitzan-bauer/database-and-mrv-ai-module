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
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const t0 = Date.now();
  const registrySearch = await searchVerraRegistry(ctx, { methodology: "VM0042", limit: 20 });
  console.log(`[${TASK_KEY}] searchVerraRegistry: ${Date.now() - t0}ms`);
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

  // Redraft only chapters that actually have a pending section — draftPddChapterContent
  // re-drafts every non-answered, non-skipped row it's given, including ones
  // already 'drafted' with nothing new to say, so handing it every chapter
  // unconditionally means re-running an LLM call per section every single
  // week for no reason (and risks the cron route's own time budget). A
  // chapter with nothing pending has nothing this week's sweep could add.
  let redraftedCount = 0;
  const t1 = Date.now();
  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  console.log(`[${TASK_KEY}] listPddSectionStatus: ${Date.now() - t1}ms (${sectionStatus?.rows.length ?? 0} rows)`);
  if (sectionStatus) {
    const chaptersWithPending = new Set(
      sectionStatus.rows.filter((r) => r.sectionLevel > 1 && r.status === "pending").map((r) =>
        chapterTitleForSectionIndex(sectionStatus.rows, r.sectionIndex),
      ),
    );
    const chapterTitles = sectionStatus.rows
      .filter((r) => r.sectionLevel === 1 && chaptersWithPending.has(r.sectionTitle))
      .map((r) => r.sectionTitle);
    console.log(`[${TASK_KEY}] chapters with pending sections: ${chapterTitles.length}`);
    if (chapterTitles.length) {
      const t2 = Date.now();
      const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles, maxSections: 5 });
      console.log(`[${TASK_KEY}] draftPddChapterContent: ${Date.now() - t2}ms`);
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
    } else {
      paragraphs.push("No chapter has a pending section this week — nothing for the drafting pass to do.");
    }
  }

  const t3 = Date.now();
  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Weekly research round — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "weekly_research_round",
  });
  console.log(`[${TASK_KEY}] finishScheduledTask: ${Date.now() - t3}ms`);

  return {
    ok: outcome.ok,
    detail: `${outcome.detail} (${newEntries.length} related project(s), ${ingestedCount} precedent(s) indexed, ${redraftedCount} section(s) drafted.)`,
  };
}
