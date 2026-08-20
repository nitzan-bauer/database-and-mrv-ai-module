import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_biweekly_new_farmer_check";

/**
 * Biweekly new-farmer check (Nitzan's own spec, live this session): no
 * "INSTALLATIONS" table exists anywhere in the schema or the VM0042
 * template (confirmed by grep) — the real intent, every new farm joining
 * the project should show up in the PDD, is served by the tools that
 * already exist: import_saas_project_farms (adds the farm to mrv.farms,
 * which the SEED questionnaire's own "Participating farms and farmers"
 * auto-fact already live-counts) + draft_pdd_chapter_content (redrafts
 * the participants section's prose). Only emails when it actually found
 * something new — Nitzan's own spec for this one task, unlike the other 4.
 */
export async function runBiweeklyNewFarmerCheck(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listSaasFarmsSince } = await import("../../saas/saasClient");
  const { importSaasProjectFarms } = await import("../../tools/importSaasProjectFarms");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const own = await query<{ last_run_at: string | null; created_at: string }>(
    `SELECT last_run_at, created_at FROM mrv.scheduled_tasks WHERE task_key = $1`,
    [TASK_KEY],
  );
  const since = own[0]?.last_run_at ?? own[0]?.created_at ?? "1970-01-01T00:00:00Z";

  let newFarms;
  try {
    newFarms = await listSaasFarmsSince(since);
  } catch (e) {
    return { ok: false, detail: `biweekly new-farmer check: could not reach the SaaS database — ${e instanceof Error ? e.message : e}` };
  }

  if (!newFarms.length) {
    const outcome = await finishScheduledTask(ctx, {
      taskKey: TASK_KEY,
      projectId: TARGET_PROJECT_ID,
      subject: `New-farmer check — ${new Date().toISOString().slice(0, 10)}`,
      bodyParagraphs: [`Checked the SaaS marketplace for farms registered since ${since.slice(0, 10)} — none found.`],
      memoryKind: "new_farmer_check",
      sendEmail: false,
    });
    return outcome;
  }

  const projects = await query<{ name: string; country: string }>(
    `SELECT name, country FROM mrv.projects WHERE project_id = $1`,
    [TARGET_PROJECT_ID],
  );
  if (!projects.length) {
    return { ok: false, detail: `biweekly new-farmer check: found ${newFarms.length} new farm(s) but ${TARGET_PROJECT_ID} doesn't exist in mrv.projects.` };
  }
  const project = projects[0];

  const importResult = await importSaasProjectFarms(ctx, {
    projectId: TARGET_PROJECT_ID,
    projectName: project.name,
    country: project.country,
    saasFarmIds: newFarms.map((f) => f.id),
  });

  const paragraphs: string[] = [];
  let redrafted = false;

  if (!importResult.ok) {
    paragraphs.push(`Found ${newFarms.length} new farm(s) in the SaaS marketplace, but importing them failed: ${importResult.error}`);
  } else {
    paragraphs.push(
      `${importResult.data.farms.length} new farm(s) joined the project and were added to the PDD's participating-farms data:`,
    );
    for (const f of importResult.data.farms) paragraphs.push(`- ${f.name}`);

    const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
    if (sectionStatus) {
      const participantsRow = sectionStatus.rows.find((r) => /participant/i.test(r.sectionTitle));
      const chapterTitle = participantsRow
        ? chapterTitleForSectionIndex(sectionStatus.rows, participantsRow.sectionIndex)
        : null;
      if (chapterTitle) {
        const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles: [chapterTitle], maxSections: 3 });
        if (draftResult.ok) {
          const drafted = draftResult.data.sections.filter((s) => s.outcome === "drafted");
          redrafted = drafted.length > 0;
          paragraphs.push(
            drafted.length
              ? `Redrafted "${chapterTitle}" to reflect the new participant list.`
              : `"${chapterTitle}" had nothing pending to redraft.`,
          );
        } else {
          paragraphs.push(`Could not redraft "${chapterTitle}": ${draftResult.error}`);
        }
      } else {
        paragraphs.push('No "Project Participants"-titled section found in the registered PDD template to redraft.');
      }
    }
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `New-farmer check — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "new_farmer_check",
    sendEmail: true,
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${newFarms.length} new farm(s), chapter redrafted: ${redrafted}.)` };
}
