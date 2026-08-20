import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_monthly_product_research";

const PRODUCT_PAGE_URL = "https://carbonature.io/projects/carbonature-farming-e-africa/";
const MAX_PRODUCT_PAGES = 8;

const SYNTHESIS_SYSTEM_PROMPT =
  "You are Rebeka, CarboNature's Validation Manager AI agent. You've just read the manufacturer product pages " +
  "for the inputs/equipment used in this project's activities. Write a factual research memo (200-400 words, " +
  "plain prose, no markdown) summarizing what each product actually is and does, grounded only in what the " +
  "pages say — never invent a spec, mechanism, or claim the source text doesn't state. End with one paragraph " +
  "on how this material could sharpen the PDD's own Project Activities description.";

/**
 * Monthly product research (Nitzan's own spec, live this session): read
 * the manufacturer product pages linked from the real project page, use
 * that to develop the PDD's own Project Activities writing.
 *
 * fetch_public_url's own text-only excerpt doesn't follow links, so this
 * handler is the reason that tool grew a `links` field this round —
 * carbonature.io's project page links out to each product's manufacturer
 * page, and reading those (not just the project page's own summary) is
 * the actual research this task asks for.
 */
export async function runMonthlyProductResearch(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { fetchPublicUrl } = await import("../../tools/fetchPublicUrl");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");
  const { getConfiguredProvider } = await import("../../agent/provider");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const projectPage = await fetchPublicUrl(ctx, { url: PRODUCT_PAGE_URL });
  if (!projectPage.ok) {
    return { ok: false, detail: `monthly product research: could not fetch the project page — ${projectPage.error}` };
  }

  const projectHost = new URL(PRODUCT_PAGE_URL).hostname;
  const externalLinks = projectPage.data.links
    .filter((l) => new URL(l).hostname !== projectHost)
    .slice(0, MAX_PRODUCT_PAGES);

  if (!externalLinks.length) {
    const outcome = await finishScheduledTask(ctx, {
      taskKey: TASK_KEY,
      projectId: TARGET_PROJECT_ID,
      subject: `Monthly product research — ${new Date().toISOString().slice(0, 10)}`,
      bodyParagraphs: [
        `Fetched ${PRODUCT_PAGE_URL} but found no external (manufacturer) product links on the page this month.`,
      ],
      memoryKind: "product_research",
    });
    return outcome;
  }

  const fetched: Array<{ url: string; title: string | null; textExcerpt: string }> = [];
  for (const link of externalLinks) {
    const page = await fetchPublicUrl(ctx, { url: link });
    if (page.ok) fetched.push({ url: link, title: page.data.title, textExcerpt: page.data.textExcerpt });
  }

  const paragraphs: string[] = [
    `Read ${fetched.length} of ${externalLinks.length} manufacturer product page(s) linked from the project page.`,
  ];

  if (fetched.length) {
    const provider = await getConfiguredProvider();
    const sourceBlock = fetched
      .map((f, i) => `[${i + 1}] ${f.title ?? f.url} (${f.url})\n${f.textExcerpt.slice(0, 1500)}`)
      .join("\n\n");
    const resp = await provider.complete({
      system: SYNTHESIS_SYSTEM_PROMPT,
      userMessage: `Product pages read this month:\n\n${sourceBlock}`,
      tools: [],
    });
    const memo = resp.kind === "text" ? resp.text.trim() : "";
    if (memo) paragraphs.push(memo);
  }

  // Find the chapter containing the "Project Activities"-titled section, so
  // this month's research actually reaches the PDD, not just the memory log.
  let redrafted = false;
  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  if (sectionStatus) {
    const activityRow = sectionStatus.rows.find((r) => /project activit/i.test(r.sectionTitle));
    const chapterTitle = activityRow ? chapterTitleForSectionIndex(sectionStatus.rows, activityRow.sectionIndex) : null;
    if (chapterTitle) {
      const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles: [chapterTitle], maxSections: 4 });
      if (draftResult.ok) {
        const draftedTitles = draftResult.data.sections.filter((s) => s.outcome === "drafted").map((s) => s.sectionTitle);
        redrafted = draftedTitles.length > 0;
        paragraphs.push(
          draftedTitles.length
            ? `Redrafted "${chapterTitle}" in light of this research: ${draftedTitles.join("; ")}.`
            : `"${chapterTitle}" had nothing pending to redraft this month.`,
        );
      } else {
        paragraphs.push(`Could not redraft "${chapterTitle}": ${draftResult.error}`);
      }
    } else {
      paragraphs.push('No "Project Activities" section found in the registered PDD template.');
    }
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Monthly product research — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "product_research",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${fetched.length} product page(s) read, chapter redrafted: ${redrafted}.)` };
}
