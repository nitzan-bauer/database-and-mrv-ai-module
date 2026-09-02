import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_monthly_credit_market_scan";

const SYSTEM_PROMPT =
  "You are John, CarboNature's Head of the AI-agent department, tracking the market to price the next " +
  "issuance. Use real web search to find recent deals and prices for: (1) Verra VM0042 (Improved " +
  "Agricultural Land Management, soil carbon) VCUs, and (2) non-Verra regenerative-agriculture credit deals " +
  "under any other registry. For each real, sourced deal you find, report: registry, methodology (real code, " +
  "or null), project_or_seller (the project or seller name), price_note (whatever the source states verbatim " +
  "— price per tonne, volume, buyer, date — never compute or estimate a number yourself), a one-sentence " +
  "brief (plain prose, what the deal actually is), and source_url. Return ONLY a JSON object, no prose, no " +
  'markdown fences: {"deals":[{"registry":string,"methodology":string|null,"project_or_seller":string,' +
  '"price_note":string,"brief":string,"source_url":string}]}. Only include a deal you found a real, ' +
  "checkable source for — never invent a price, a party, or a URL. If you find nothing solid, return an " +
  "empty array.";

interface ScannedDeal {
  registry: string;
  methodology: string | null;
  project_or_seller: string;
  price_note: string;
  brief: string;
  source_url: string;
}

function parseDeals(text: string): ScannedDeal[] {
  try {
    // .trim() BEFORE stripping fences: the strip regexes are anchored to
    // the literal string start/end (no `m` flag), so a stray leading
    // newline or trailing space around the ``` fence — routine model
    // output noise — silently defeated them, JSON.parse then threw, and
    // the catch below returned [], indistinguishable from a genuine
    // "found nothing this month."
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { deals?: ScannedDeal[] };
    return parsed.deals ?? [];
  } catch {
    return [];
  }
}

/**
 * John's monthly credit market/price tracker (Nitzan's own spec, attached
 * prompt: the department dashboard's "category market tracker" card).
 * Each find is a row in mrv.market_scan_deals (0080); upsert is on
 * (registry, project_or_seller, price_note) so the same reported deal
 * doesn't duplicate on a later month's re-scan.
 */
export async function runMonthlyCreditMarketScan(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { getConfiguredProvider } = await import("../../agent/provider");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  // Agent-learning plan (0078), same pattern as draftPddChapterContent.ts:
  // past lessons on this exact task, folded into the search prompt so
  // recorded outcomes actually influence the next run instead of sitting
  // unread in mrv.agent_memory.
  const { recallLessons } = await import("../lessonMemory");
  const pastLessons = await recallLessons(ctx, { actionName: TASK_KEY, projectId: TARGET_PROJECT_ID });
  const lessonsBlock = pastLessons.length
    ? "\n\nLessons from past runs (apply these — don't repeat a known mistake):\n" +
      pastLessons.map((l) => `- ${l.content}`).join("\n")
    : "";

  const provider = await getConfiguredProvider();
  const t0 = Date.now();
  const resp = await provider.complete({
    system: SYSTEM_PROMPT,
    userMessage:
      `Today's date: ${new Date().toISOString().slice(0, 10)}. Search for recent VM0042 and non-Verra ` +
      `regenerative-agriculture carbon-credit deals and prices.` +
      lessonsBlock,
    tools: [],
    // Measured live: finding real, sourced deal/price data consistently
    // needs longer than finding project names does (prices are sparser,
    // so the model reformulates its search more) — this task is staggered
    // onto its own day (0080's seed / the manual staggering done live
    // this session) so it no longer shares one cron invocation's 60s
    // budget with the project scan, and can afford real headroom here.
    webSearch: { maxUses: 2, timeoutMs: 45_000 },
  });
  console.log(`[${TASK_KEY}] web-search model call: ${Date.now() - t0}ms`);

  const found = resp.kind === "text" ? parseDeals(resp.text) : [];
  const paragraphs: string[] = [];
  let inserted = 0;

  if (!found.length) {
    paragraphs.push("This month's search found no checkable, sourced deal to add.");
  } else {
    for (const d of found) {
      const result = await query<{ scan_deal_id: string }>(
        `INSERT INTO mrv.market_scan_deals (registry, methodology, project_or_seller, price_note, brief, source_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (registry, project_or_seller, price_note) DO NOTHING
         RETURNING scan_deal_id`,
        [d.registry, d.methodology, d.project_or_seller, d.price_note, d.brief, d.source_url],
      );
      if (result.length) {
        inserted++;
        paragraphs.push(`New: ${d.project_or_seller} (${d.registry}) — ${d.price_note}. ${d.brief} Source: ${d.source_url}`);
      }
    }
    if (!inserted) paragraphs.push(`Found ${found.length} deal(s), all already known from an earlier scan.`);
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Monthly credit market scan — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "credit_market_scan",
    agentId: "john",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${inserted} new deal(s) of ${found.length} found.)` };
}
