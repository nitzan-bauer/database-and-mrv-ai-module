import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_weekly_research_round";

const MAX_WEB_RESEARCH_PAGES = 4;

const WEB_DISCOVERY_SYSTEM_PROMPT =
  "You are Rebeka, CarboNature's Validation Manager AI agent, researching this week beyond Verra's own " +
  "registry (a separate step already covers that). Use your real web-search tool to find real, recent news, " +
  "case studies, methodology updates, or industry analysis relevant to VM0042 (Improved Agricultural Land " +
  "Management) carbon projects or comparable regenerative-agriculture carbon methodologies — the kind of " +
  "context that sharpens a related-project or PDD analysis but wouldn't show up in the registry's own listing. " +
  "Respond with ONLY the URLs you found from real search results, one per line, nothing else — no prose, no " +
  "numbering. If you find nothing genuinely relevant, respond with exactly: NONE.";

const WEB_SYNTHESIS_SYSTEM_PROMPT =
  "You are Rebeka, CarboNature's Validation Manager AI agent. You've just read the pages below, found this " +
  "week via a real web search. Write only from what they actually say — never invent a claim no source " +
  "states. Write a short factual note (100-200 words, plain prose, no markdown) on anything here relevant to " +
  "VM0042 related-project or methodology analysis. If nothing here is actually relevant, say so plainly in " +
  "one sentence instead of padding.";

/**
 * Weekly research round (Nitzan's own spec, live this session): a
 * research sweep including the RELATED PROJECT process, a real open-web
 * research pass, and updating the PDD where there's something to update,
 * then the report/memory/DB/email close shared by all 5 tasks
 * (finishScheduledTask).
 *
 * "RELATED PROJECT process" is exactly the existing download_related_pdds
 * + ingest_related_pdd_precedents pair — this handler's only real
 * decision is which Verra projects count as "related" for an
 * unattended run: the up-to-3 newest VM0042 registry entries
 * search_verra_registry hasn't seen before, capped so one week's
 * automated sweep can't run away downloading dozens of projects' files.
 *
 * The three steps below (registry sweep, open-web research, PDD redraft)
 * touch different data and don't read each other's output, so they run
 * concurrently — confirmed necessary live this session, on this exact
 * task's sibling (monthlyProductResearch.ts): run steps like these one
 * after another and the whole task's wall-clock time lands well past
 * Vercel's 60s function ceiling for the cron route this runs in.
 */
async function runRegistryStep(
  ctx: ToolContext,
): Promise<{ paragraphs: string[]; newEntriesCount: number; ingestedCount: number }> {
  const { searchVerraRegistry } = await import("../../tools/searchVerraRegistry");
  const { downloadRelatedPdds } = await import("../../tools/downloadRelatedPdds");
  const { ingestRelatedPddPrecedents } = await import("../../tools/ingestRelatedPddPrecedents");

  const t0 = Date.now();
  const registrySearch = await searchVerraRegistry(ctx, { methodology: "VM0042", limit: 20 });
  console.log(`[${TASK_KEY}] searchVerraRegistry: ${Date.now() - t0}ms`);
  if (!registrySearch.ok) {
    return { paragraphs: [`search_verra_registry failed — ${registrySearch.error}`], newEntriesCount: 0, ingestedCount: 0 };
  }

  const newEntries = registrySearch.data.entries.filter((e) => e.isNew).slice(0, 3);
  const paragraphs: string[] = [
    `Weekly VM0042 registry sweep: ${registrySearch.data.totalMatching} projects matching, ` +
      `${registrySearch.data.newSinceLastCheck} new since the last check.`,
  ];

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

  return { paragraphs, newEntriesCount: newEntries.length, ingestedCount };
}

/**
 * The genuinely new capability (Nitzan's own request, live this session):
 * before this, this task's only "web access" was Verra's own structured
 * registry API — no general web search, no reading an arbitrary real
 * page. This searches the open web for real, current context the
 * registry itself wouldn't carry, then actually fetches and reads every
 * URL it names before using it — never trusting a search snippet alone,
 * matching monthlyProductResearch.ts's own "never invent a spec" rule.
 */
async function runWebResearchStep(ctx: ToolContext): Promise<{ paragraphs: string[]; accessFailed: string | null }> {
  const { fetchPublicUrl } = await import("../../tools/fetchPublicUrl");
  const { getConfiguredProvider } = await import("../../agent/provider");
  const provider = await getConfiguredProvider();

  const t0 = Date.now();
  const discoveryResp = await provider.complete({
    system: WEB_DISCOVERY_SYSTEM_PROMPT,
    userMessage: "Find current, real, relevant context beyond Verra's own registry listing.",
    tools: [],
    webSearch: { maxUses: 3, timeoutMs: 30_000 },
  });
  console.log(`[${TASK_KEY}] web discovery search: ${Date.now() - t0}ms`);

  // Nitzan's own request, live this session: 0 real searches executed
  // despite requesting web search is a genuine access failure, not an
  // unremarkable "nothing relevant this week" — flagged so it shows as
  // this task's own failure rather than a quiet, empty-looking week.
  if (discoveryResp.webSearchesPerformed === 0) {
    return {
      paragraphs: ["Open-web research: the real web-search tool did not execute a single search this week (0 searches)."],
      accessFailed: "web search did not run this week (0 searches executed)",
    };
  }

  const urls =
    discoveryResp.kind === "text"
      ? [...new Set(discoveryResp.text.match(/https?:\/\/\S+/g) ?? [])]
          .map((u) => u.replace(/[.,)\]]+$/, ""))
          .slice(0, MAX_WEB_RESEARCH_PAGES)
      : [];
  if (!urls.length) {
    return { paragraphs: ["Open-web research: nothing new and genuinely relevant found this week."], accessFailed: null };
  }

  const t1 = Date.now();
  const pageResults = await Promise.all(urls.map((url) => fetchPublicUrl(ctx, { url })));
  console.log(`[${TASK_KEY}] parallel fetch ${urls.length} discovered pages: ${Date.now() - t1}ms`);
  const fetched = pageResults
    .map((page, i) => (page.ok ? { url: urls[i], title: page.data.title, textExcerpt: page.data.textExcerpt } : null))
    .filter((p): p is { url: string; title: string | null; textExcerpt: string } => p !== null);
  if (!fetched.length) {
    return {
      paragraphs: ["Open-web research found candidate pages but none could actually be read."],
      accessFailed: "search found candidate URLs but every one of them failed to fetch",
    };
  }

  const sourceBlock = fetched.map((f, i) => `[${i + 1}] ${f.title ?? f.url} (${f.url})\n${f.textExcerpt.slice(0, 900)}`).join("\n\n");
  const t2 = Date.now();
  const resp = await provider.complete({
    system: WEB_SYNTHESIS_SYSTEM_PROMPT,
    userMessage: `Pages found this week:\n\n${sourceBlock}`,
    tools: [],
    timeoutMs: 30_000,
    maxTokens: 2048,
  });
  console.log(`[${TASK_KEY}] web research synthesis: ${Date.now() - t2}ms`);
  const note = resp.kind === "text" ? resp.text.trim() : "";
  return {
    paragraphs: [
      `Open-web research: read ${fetched.length} page(s) found via search this week.`,
      `Sources read: ${fetched.map((f) => f.url).join(", ")}`,
      ...(note ? [note] : []),
    ],
    accessFailed: null,
  };
}

/**
 * Redrafts only PDD chapters with an actually-pending section —
 * draftPddChapterContent re-drafts every non-answered, non-skipped row
 * it's given, including ones already 'drafted' with nothing new to say,
 * so handing it every chapter unconditionally means re-running an LLM
 * call per section every single week for no reason. A chapter with
 * nothing pending has nothing this week's sweep could add.
 */
async function runPddRedraftStep(ctx: ToolContext): Promise<{ paragraphs: string[]; redraftedCount: number }> {
  const { query } = await import("../../db");
  const { draftPddChapterContent } = await import("../../tools/draftPddChapterContent");
  const { listPddSectionStatus, chapterTitleForSectionIndex } = await import("../../pdd/sectionStatus");

  const t1 = Date.now();
  const sectionStatus = await listPddSectionStatus(query, TARGET_PROJECT_ID);
  console.log(`[${TASK_KEY}] listPddSectionStatus: ${Date.now() - t1}ms (${sectionStatus?.rows.length ?? 0} rows)`);
  if (!sectionStatus) return { paragraphs: [], redraftedCount: 0 };

  const chaptersWithPending = new Set(
    sectionStatus.rows.filter((r) => r.sectionLevel > 1 && r.status === "pending").map((r) =>
      chapterTitleForSectionIndex(sectionStatus.rows, r.sectionIndex),
    ),
  );
  const chapterTitles = sectionStatus.rows
    .filter((r) => r.sectionLevel === 1 && chaptersWithPending.has(r.sectionTitle))
    .map((r) => r.sectionTitle);
  console.log(`[${TASK_KEY}] chapters with pending sections: ${chapterTitles.length}`);
  if (!chapterTitles.length) {
    return { paragraphs: ["No chapter has a pending section this week — nothing for the drafting pass to do."], redraftedCount: 0 };
  }

  const t2 = Date.now();
  const draftResult = await draftPddChapterContent(ctx, { projectId: TARGET_PROJECT_ID, chapterTitles, maxSections: 3 });
  console.log(`[${TASK_KEY}] draftPddChapterContent: ${Date.now() - t2}ms`);
  if (!draftResult.ok) {
    return { paragraphs: [`Could not run the drafting pass: ${draftResult.error}`], redraftedCount: 0 };
  }
  const drafted = draftResult.data.sections.filter((s) => s.outcome === "drafted");
  return {
    paragraphs: [
      drafted.length
        ? `Drafted ${drafted.length} PDD section(s): ${drafted.map((s) => s.sectionTitle).join("; ")}.`
        : "No PDD sections had new guidance or direction to draft against this week.",
    ],
    redraftedCount: drafted.length,
  };
}

export async function runWeeklyResearchRound(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const [registry, webResearch, pddRedraft] = await Promise.all([
    runRegistryStep(ctx),
    runWebResearchStep(ctx),
    runPddRedraftStep(ctx),
  ]);

  const t3 = Date.now();
  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Weekly research round — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: [...registry.paragraphs, ...webResearch.paragraphs, ...pddRedraft.paragraphs],
    memoryKind: "weekly_research_round",
  });
  console.log(`[${TASK_KEY}] finishScheduledTask: ${Date.now() - t3}ms`);

  // Nitzan's own request, live this session: a genuine web-access failure
  // (the search tool never executing a single search this week) has to
  // surface as this task's own failure — a red status in the Scheduled
  // Tasks panel — not get absorbed into an otherwise-successful-looking
  // weekly report. The registry sweep, PDD redraft, and email above still
  // ran and are reported either way.
  const ok = outcome.ok && !webResearch.accessFailed;
  const summary =
    `(${registry.newEntriesCount} related project(s), ${registry.ingestedCount} precedent(s) indexed, ` +
    `${pddRedraft.redraftedCount} section(s) drafted.)`;
  return {
    ok,
    detail: webResearch.accessFailed
      ? `${outcome.detail} — ACCESS FAILURE: ${webResearch.accessFailed}. ${summary}`
      : `${outcome.detail} ${summary}`,
  };
}
