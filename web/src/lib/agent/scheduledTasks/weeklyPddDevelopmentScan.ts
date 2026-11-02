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
 *
 * Second trigger (2026-11-02): reference material the agent has newly learned
 * (kind 'protocol', source 'reference_library' — the methodology's Corrections
 * & Clarifications and the like, stored by referenceIngest.ts) since the last
 * scan. The chapters those rules bear on are redrafted too, so what she learns
 * actually reaches the PDD instead of waiting for someone to leave a comment.
 * A manual run can force it with taskParams.applyReferenceLibrary = "true" and
 * lift the per-run section cap with taskParams.maxSections.
 */

// Chapters of the VCS PDD template that VM0042's rules (baseline per eligibility area, additionality,
// quantification units, leakage) bear on.
const REFERENCE_AFFECTED_CHAPTERS = [
  "Application of Methodology",
  "Quantification of Estimated Reductions and Removals",
];
const DEFAULT_MAX_SECTIONS = 3;
export async function runWeeklyPddDevelopmentScan(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const own = await query<{ last_run_at: string | Date | null }>(
    `SELECT last_run_at FROM mrv.scheduled_tasks WHERE task_key = $1`,
    [TASK_KEY],
  );
  // node-postgres hands back a timestamptz column as a native Date, not a
  // string (confirmed live in biweeklyNewFarmerCheck.ts's identical
  // pattern — the raw value broke a URL query there). Only worked here
  // on this task's first-ever run because last_run_at was still null,
  // taking the string-literal fallback — new Date(x) is a no-op for an
  // already-Date x, so both the null case and a real Date are safe now.
  const since = new Date(own[0]?.last_run_at ?? "1970-01-01T00:00:00Z").toISOString();

  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  if (!sectionStatus) {
    return { ok: false, detail: "weekly PDD Development scan: no PDD template registered yet." };
  }

  const commented = sectionStatus.rows.filter(
    (r) => r.reviewComment?.trim() && new Date(r.updatedAt).getTime() > new Date(since).getTime(),
  );

  const paragraphs: string[] = [];
  let redraftedCount = 0;

  const newReference = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.agent_memory
      WHERE kind = 'protocol' AND metadata->>'source' = 'reference_library' AND created_at > $1`,
    [since],
  );
  const newReferencePieces = Number(newReference[0]?.n ?? 0);
  const applyReference = newReferencePieces > 0 || ctx.taskParams?.applyReferenceLibrary === "true";
  const maxSectionsParam = Number(ctx.taskParams?.maxSections);
  const maxSections = Number.isInteger(maxSectionsParam) && maxSectionsParam > 0 ? maxSectionsParam : DEFAULT_MAX_SECTIONS;

  if (!commented.length) {
    paragraphs.push(`Review comments: none added by the founder since the last scan (${since.slice(0, 10)}). This says nothing about whether the draft changed — see the redrafted sections below.`);
  } else {
    paragraphs.push(`${commented.length} section(s) with a new or changed review comment since the last scan:`);
    for (const r of commented) {
      paragraphs.push(`- "${r.sectionTitle}": ${r.reviewComment}`);
    }
  }

  const chapterTitles = [
    ...new Set([
      ...commented
        .map((r) => chapterTitleForSectionIndex(sectionStatus.rows, r.sectionIndex))
        .filter((t): t is string => Boolean(t)),
      ...(applyReference ? REFERENCE_AFFECTED_CHAPTERS : []),
    ]),
  ];

  if (applyReference) {
    paragraphs.push(
      newReferencePieces > 0
        ? `${newReferencePieces} new piece(s) of reference material learned since the last scan — the chapters they bear on are redrafted with it: ${REFERENCE_AFFECTED_CHAPTERS.join("; ")}.`
        : `Redrafting the chapters that VM0042's reference rules bear on (run on request): ${REFERENCE_AFFECTED_CHAPTERS.join("; ")}.`,
    );
  }

  if (chapterTitles.length) {
    const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles, maxSections });
    if (draftResult.ok) {
      const drafted = draftResult.data.sections.filter((s) => s.outcome === "drafted");
      redraftedCount = drafted.length;
      paragraphs.push(
        drafted.length
          ? `Redrafted ${drafted.length} section(s): ${drafted.map((s) => s.sectionTitle).join("; ")}.`
          : "The chapters had nothing pending to redraft (comments may be on already-answered sections needing a person's own edit, not a redraft).",
      );
    } else {
      paragraphs.push(`Could not run the drafting pass: ${draftResult.error}`);
    }
  }

  // Lead with what actually happened to the PDD, so a report about "no new comments" is never read as "nothing changed".
  const reasons = [
    commented.length ? `${commented.length} review comment(s)` : "",
    newReferencePieces > 0 ? `${newReferencePieces} new piece(s) of reference material` : "",
  ].filter(Boolean);
  paragraphs.unshift(
    redraftedCount
      ? `Summary: ${redraftedCount} PDD section(s) were redrafted because of ${reasons.join(" and ") || "a requested run"}. The previous versions are kept in each section's history.`
      : "Summary: no PDD section was redrafted this scan.",
  );

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `PDD Development scan — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "pdd_development_scan",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${commented.length} commented section(s), ${newReferencePieces} new reference piece(s), ${redraftedCount} redrafted.)` };
}
