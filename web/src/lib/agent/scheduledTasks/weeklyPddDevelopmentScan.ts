import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_weekly_pdd_development_scan";

/**
 * Weekly PDD Development scan (Nitzan's own spec, live this session):
 * scan the PDD Development interface for updates/comments and update the
 * PDD accordingly. "Comments" here is real, already-built structure —
 * mrv.pdd_section_status.review_comment (0067), Nitzan's own notes to
 * Rebeka about a drafted section, human-only to write. New or changed
 * since the last scan (this task's own last_run_at) is what counts as
 * "found an update" — every comment ever left isn't re-drafted every
 * week forever.
 */
export async function runWeeklyPddDevelopmentScan(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const own = await query<{ last_run_at: string | null }>(
    `SELECT last_run_at FROM mrv.scheduled_tasks WHERE task_key = $1`,
    [TASK_KEY],
  );
  const since = own[0]?.last_run_at ?? "1970-01-01T00:00:00Z";

  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  if (!sectionStatus) {
    return { ok: false, detail: "weekly PDD Development scan: no PDD template registered yet." };
  }

  const commented = sectionStatus.rows.filter(
    (r) => r.reviewComment?.trim() && new Date(r.updatedAt).getTime() > new Date(since).getTime(),
  );

  const paragraphs: string[] = [];
  let redraftedCount = 0;

  if (!commented.length) {
    paragraphs.push(`No new or changed review comments in PDD Development since the last scan (${since.slice(0, 10)}).`);
  } else {
    paragraphs.push(`${commented.length} section(s) with a new or changed review comment since the last scan:`);
    for (const r of commented) {
      paragraphs.push(`- "${r.sectionTitle}": ${r.reviewComment}`);
    }

    const chapterTitles = [
      ...new Set(
        commented
          .map((r) => chapterTitleForSectionIndex(sectionStatus.rows, r.sectionIndex))
          .filter((t): t is string => Boolean(t)),
      ),
    ];

    if (chapterTitles.length) {
      const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles, maxSections: 5 });
      if (draftResult.ok) {
        const drafted = draftResult.data.sections.filter((s) => s.outcome === "drafted");
        redraftedCount = drafted.length;
        paragraphs.push(
          drafted.length
            ? `Redrafted ${drafted.length} section(s) in response: ${drafted.map((s) => s.sectionTitle).join("; ")}.`
            : "The commented sections' chapters had nothing pending to redraft (comments may be on already-answered sections needing a person's own edit, not a redraft).",
        );
      } else {
        paragraphs.push(`Could not run the drafting pass: ${draftResult.error}`);
      }
    }
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `PDD Development scan — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "pdd_development_scan",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${commented.length} commented section(s), ${redraftedCount} redrafted.)` };
}
