import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_monthly_product_research";

const PRODUCT_PAGE_URL = "https://carbonature.io/projects/carbonature-farming-e-africa/";
const MAX_CURATED_PAGES = 15;
const MAX_DISCOVERED_PAGES = 5;

/** carbonature.io's own subdomains (app.carbonature.io, etc.) are not manufacturer pages — this is the bug that let register/login pages eat 2 of the 5 old slots. */
function isSameSite(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

/**
 * Multicote Agri Junior and CoteN were permanently removed from the
 * platform (Nitzan's own request, migrations/0096) — but this task's own
 * discovery phase runs a genuine, fresh web search every month, which
 * could re-surface Haifa's own product pages for either on its own,
 * independent of what the live carbonature.io page or the DB still say.
 * Filtered by hostname/URL rather than by title text, since a page has to
 * be excluded before it's ever fetched.
 */
const EXCLUDED_DISCOVERY_HOSTS_PATTERNS: RegExp[] = [/multicote/i, /coten/i];
function isExcludedDiscovery(url: string): boolean {
  return EXCLUDED_DISCOVERY_HOSTS_PATTERNS.some((re) => re.test(url));
}

const DISCOVERY_SYSTEM_PROMPT =
  "You are Rebeka, CarboNature's Validation Manager AI agent, researching real agricultural-input " +
  "manufacturers relevant to this carbon project's activities (soil biostimulants, controlled-release " +
  "fertilizers, mycorrhizal inoculants, and similar soil-health inputs for regenerative smallholder farming). " +
  "You are given a list of manufacturer products already covered this month. Use your real web-search tool to " +
  "find OTHER real manufacturer product pages, in the same or an adjacent category, that are NOT already " +
  "covered. Never suggest Haifa Group's Multicote (Agri Junior) or CoteN — both were permanently removed from " +
  "this platform and must not be researched or reported on again, regardless of how relevant they might seem. " +
  "Respond with ONLY the URLs you found from real search results, one per line, nothing else — no prose, no " +
  "numbering, no explanation. If you find nothing new, respond with exactly: NONE.";

const SYNTHESIS_SYSTEM_PROMPT =
  "You are Rebeka, CarboNature's Validation Manager AI agent. You've just read the manufacturer product pages " +
  "for the inputs/equipment used in this project's activities — some linked from the project's own page, some " +
  "found this month via a real web search and then actually read. Write only from what these pages actually " +
  "say — never invent a spec, mechanism, or claim no source states. Write a factual research memo (200-400 " +
  "words, plain prose, no markdown) summarizing what each product actually is and does. End with one " +
  "paragraph on how this material could sharpen the PDD's own Project Activities description.";

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
interface FetchedPage {
  url: string;
  title: string | null;
  textExcerpt: string;
  source: "curated" | "discovered";
}

/**
 * Reads the real project page's own linked products plus whatever a real
 * web search finds beyond them, and writes the research memo. Independent
 * of the PDD redraft below — no shared state — so the two run
 * concurrently.
 *
 * `accessFailed` (Nitzan's own request, live this session): a real
 * inability to reach the web — the project page itself unreachable, or
 * the search tool never actually running — is a bug and must show as
 * this task's failure, not get folded into "nothing new this month."
 * Whenever access genuinely worked, the report names every real URL
 * actually read, not just a count.
 */
async function runResearchStep(ctx: ToolContext): Promise<{ paragraphs: string[]; pagesRead: number; accessFailed: string | null }> {
  const { fetchPublicUrl } = await import("../../tools/fetchPublicUrl");
  const { getConfiguredProvider } = await import("../../agent/provider");
  const provider = await getConfiguredProvider();

  const t0 = Date.now();
  const projectPage = await fetchPublicUrl(ctx, { url: PRODUCT_PAGE_URL });
  console.log(`[${TASK_KEY}] fetch project page: ${Date.now() - t0}ms`);
  if (!projectPage.ok) {
    return {
      paragraphs: [`Could not fetch the project page (${PRODUCT_PAGE_URL}) — ${projectPage.error}`],
      pagesRead: 0,
      accessFailed: `could not reach ${PRODUCT_PAGE_URL}`,
    };
  }

  const projectHost = new URL(PRODUCT_PAGE_URL).hostname;
  const curatedLinks = projectPage.data.links
    .filter((l) => !isSameSite(new URL(l).hostname, projectHost) && !isExcludedDiscovery(l))
    .slice(0, MAX_CURATED_PAGES);

  // The curated-page fetch and the discovery search are independent — the
  // search only needs the list of already-known URLs (to avoid suggesting
  // a duplicate), not their fetched content — so they run in parallel, not
  // sequentially.
  const t1 = Date.now();
  const [curatedResults, discoveryResp] = await Promise.all([
    Promise.all(curatedLinks.map((link) => fetchPublicUrl(ctx, { url: link }))),
    provider.complete({
      system: DISCOVERY_SYSTEM_PROMPT,
      userMessage: `Already covered this month (by URL):\n${curatedLinks.length ? curatedLinks.join("\n") : "(none yet)"}`,
      tools: [],
      webSearch: { maxUses: 3, timeoutMs: 30_000 },
    }),
  ]);
  console.log(`[${TASK_KEY}] parallel: fetch ${curatedLinks.length} curated pages + discovery search: ${Date.now() - t1}ms`);
  const searchAccessFailed = discoveryResp.webSearchesPerformed === 0;
  const fetched: FetchedPage[] = [];
  curatedResults.forEach((page, i) => {
    if (page.ok) fetched.push({ url: curatedLinks[i], title: page.data.title, textExcerpt: page.data.textExcerpt, source: "curated" });
  });
  const discoveredUrls =
    discoveryResp.kind === "text"
      ? [...new Set(discoveryResp.text.match(/https?:\/\/\S+/g) ?? [])]
          .map((u) => u.replace(/[.,)\]]+$/, "")) // strip trailing prose punctuation the model may have left on
          .filter((u) => !curatedLinks.includes(u) && !isExcludedDiscovery(u))
          .slice(0, MAX_DISCOVERED_PAGES)
      : [];

  if (discoveredUrls.length) {
    const t1c = Date.now();
    const discoveredResults = await Promise.all(discoveredUrls.map((url) => fetchPublicUrl(ctx, { url })));
    console.log(`[${TASK_KEY}] parallel fetch ${discoveredUrls.length} discovered product pages: ${Date.now() - t1c}ms`);
    discoveredResults.forEach((page, i) => {
      if (page.ok) fetched.push({ url: discoveredUrls[i], title: page.data.title, textExcerpt: page.data.textExcerpt, source: "discovered" });
    });
  }

  const accessFailed = searchAccessFailed
    ? "the real web-search tool did not execute a single search this month (0 searches) — a genuine access failure, separate from whether the project page's own curated links still worked"
    : null;

  if (!fetched.length) {
    return {
      paragraphs: [
        `Fetched ${PRODUCT_PAGE_URL} but found no product pages to read this month — neither linked from the ` +
          `page nor via search.`,
      ],
      pagesRead: 0,
      accessFailed,
    };
  }

  const discoveredCount = fetched.filter((f) => f.source === "discovered").length;
  const paragraphs: string[] = [
    `Read ${fetched.length} manufacturer product page(s) this month: ${fetched.length - discoveredCount} ` +
      `linked from the project page, ${discoveredCount} found via a real web search` +
      (searchAccessFailed ? " (search itself did not run this month — see below)" : "") +
      ".",
    `Sources read: ${fetched.map((f) => f.url).join(", ")}`,
  ];
  if (accessFailed) paragraphs.push(`⚠ Access failure this month: ${accessFailed}.`);

  // Agent-learning plan (0078), same pattern as draftPddChapterContent.ts:
  // past lessons on this exact task, folded into the synthesis prompt so
  // recorded outcomes actually influence the next run instead of sitting
  // unread in mrv.agent_memory.
  const { recallLessons } = await import("../lessonMemory");
  const pastLessons = await recallLessons(ctx, { actionName: TASK_KEY, projectId: TARGET_PROJECT_ID });
  const lessonsBlock = pastLessons.length
    ? "\n\nLessons from past runs (apply these — don't repeat a known mistake):\n" +
      pastLessons.map((l) => `- ${l.content}`).join("\n")
    : "";

  // Leaner than the old 1500-char slice: this step's own input just grew
  // from at most 5 curated pages to up to 20 (curated + discovered), and
  // confirmed live this session, a second real web-search tool bolted onto
  // an already-15-page synthesis call pushed generation time well past
  // even a generous 45s. Discovery already did the real searching;
  // synthesis just has to write well over what was already fetched, so
  // dropping webSearch here trades a marginal "one more search" against
  // reliably finishing at all.
  const sourceBlock = fetched
    .map((f, i) => `[${i + 1}] ${f.title ?? f.url} (${f.url})\n${f.textExcerpt.slice(0, 900)}`)
    .join("\n\n");
  const t2 = Date.now();
  const resp = await provider.complete({
    system: SYNTHESIS_SYSTEM_PROMPT,
    userMessage: `Product pages read this month:\n\n${sourceBlock}` + lessonsBlock,
    tools: [],
    timeoutMs: 40_000,
    maxTokens: 4096,
  });
  console.log(`[${TASK_KEY}] synthesis model call: ${Date.now() - t2}ms`);
  const memo = resp.kind === "text" ? resp.text.trim() : "";
  if (memo) paragraphs.push(memo);

  return { paragraphs, pagesRead: fetched.length, accessFailed };
}

/** Redrafts the PDD's "Project Activities" section. Shares no state with the research step above, so the two run concurrently rather than one after the other. */
async function runPddRedraftStep(ctx: ToolContext): Promise<{ paragraphs: string[]; redrafted: boolean }> {
  const { query } = await import("../../db");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");

  const t3 = Date.now();
  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  if (!sectionStatus) return { paragraphs: [], redrafted: false };

  const activityRow = sectionStatus.rows.find((r) => /project activit/i.test(r.sectionTitle));
  const chapterTitle = activityRow ? chapterTitleForSectionIndex(sectionStatus.rows, activityRow.sectionIndex) : null;
  if (!chapterTitle) {
    return { paragraphs: ['No "Project Activities" section found in the registered PDD template.'], redrafted: false };
  }

  const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles: [chapterTitle], maxSections: 3 });
  console.log(`[${TASK_KEY}] draftPddChapterContent: ${Date.now() - t3}ms`);
  if (!draftResult.ok) {
    return { paragraphs: [`Could not redraft "${chapterTitle}": ${draftResult.error}`], redrafted: false };
  }
  const draftedTitles = draftResult.data.sections.filter((s) => s.outcome === "drafted").map((s) => s.sectionTitle);
  return {
    paragraphs: [
      draftedTitles.length
        ? `Redrafted "${chapterTitle}" in light of this research: ${draftedTitles.join("; ")}.`
        : `"${chapterTitle}" had nothing pending to redraft this month.`,
    ],
    redrafted: draftedTitles.length > 0,
  };
}

export async function runMonthlyProductResearch(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  // These two pipelines touch different parts of the project (manufacturer
  // research vs. the PDD's own Project Activities section) and neither
  // reads the other's output, so they run concurrently rather than
  // sequentially. Confirmed live this session: run one after the other and
  // the whole task's real wall-clock time landed at 86-97s, well past
  // Vercel's 60s function ceiling for the cron route this runs in —
  // running them side by side brings the total down toward the slower of
  // the two alone, not their sum.
  const [research, pddRedraft] = await Promise.all([runResearchStep(ctx), runPddRedraftStep(ctx)]);

  const t4 = Date.now();
  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Monthly product research — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: [...research.paragraphs, ...pddRedraft.paragraphs],
    memoryKind: "product_research",
  });
  console.log(`[${TASK_KEY}] finishScheduledTask (PDF+email+lesson): ${Date.now() - t4}ms`);

  // Nitzan's own request, live this session: a genuine web-access failure
  // (the project page unreachable, or the search tool never executing a
  // single search) has to surface as this task's own failure — a red
  // status in the Scheduled Tasks panel — not get absorbed into an
  // otherwise-successful-looking report. The email/PDF/lesson above still
  // go out either way, so nothing about the redraft or the report itself
  // is lost; only the reported outcome changes.
  const ok = outcome.ok && !research.accessFailed;
  const detail = research.accessFailed
    ? `${outcome.detail} — ACCESS FAILURE: ${research.accessFailed}. (${research.pagesRead} product page(s) read, chapter redrafted: ${pddRedraft.redrafted}.)`
    : `${outcome.detail} (${research.pagesRead} product page(s) read, chapter redrafted: ${pddRedraft.redrafted}.)`;
  return { ok, detail };
}
