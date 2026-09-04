import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import { fetchAndExtractPage, validatePublicUrl } from "./fetchPublicUrl";

export interface BrowsedPage {
  url: string;
  title: string | null;
  textExcerpt: string;
  truncated: boolean;
}

export interface BrowsedWebsite {
  startUrl: string;
  pages: BrowsedPage[];
  pagesVisited: number;
  /** True when the crawl stopped before exhausting every same-origin link it found — hitting maxPages or the time budget, not a failure. */
  stoppedEarly: boolean;
  fetchedAt: string;
}

const MAX_PAGES_DEFAULT = 5;
const MAX_PAGES_CAP = 8;
/** Lower than fetchPublicUrl's own 6000 — several pages combine into one tool result, so each page's share has to be smaller. */
const PER_PAGE_CHARS = 2500;
/** Total wall-clock budget for the whole crawl, well inside runAgentTask's 45s interactive-turn timeout and a scheduled task's own budget. */
const CRAWL_BUDGET_MS = 25_000;

/**
 * Explores more than one page of a real site — fetch_public_url reads
 * exactly one URL and never follows a link from it, which is not enough to
 * "look at a commercial site's product pages" the way Rebeka was asked to
 * for Haifa Group. This walks the start page's same-origin links
 * breadth-first, up to maxPages total, reusing fetchPublicUrl's own
 * fetch-and-sanitize logic (fetchAndExtractPage) and SSRF check
 * (validatePublicUrl) for every page it touches — not a second, looser
 * implementation of either.
 */
export async function browseWebsite(
  ctx: ToolContext,
  input: { startUrl: string; maxPages?: number },
): Promise<ToolResult<BrowsedWebsite>> {
  const policy = await checkPolicy("browse_website", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  let start: URL;
  try {
    start = new URL(input.startUrl);
  } catch {
    return fail(`browseWebsite: "${input.startUrl}" is not a valid URL.`);
  }
  const invalidReason = validatePublicUrl(start);
  if (invalidReason) return fail(`browseWebsite: ${invalidReason}`);

  const maxPages = Math.max(1, Math.min(Math.trunc(input.maxPages ?? MAX_PAGES_DEFAULT), MAX_PAGES_CAP));
  const deadline = Date.now() + CRAWL_BUDGET_MS;

  const visited = new Set<string>([start.toString()]);
  const queue: URL[] = [start];
  const pages: BrowsedPage[] = [];
  let timedOut = false;

  while (queue.length && pages.length < maxPages) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const next = queue.shift()!;
    let page;
    try {
      page = await fetchAndExtractPage(next, PER_PAGE_CHARS);
    } catch {
      continue; // one unreachable page doesn't sink the whole crawl
    }
    pages.push({ url: next.toString(), title: page.title, textExcerpt: page.textExcerpt, truncated: page.truncated });

    for (const link of page.links) {
      if (visited.has(link)) continue;
      let linkUrl: URL;
      try {
        linkUrl = new URL(link);
      } catch {
        continue;
      }
      if (linkUrl.hostname !== start.hostname) continue; // same-origin only
      if (validatePublicUrl(linkUrl)) continue;
      visited.add(link);
      queue.push(linkUrl);
    }
  }

  if (!pages.length) {
    return fail(`browseWebsite: could not fetch "${input.startUrl}" or any page from it.`);
  }

  const result: BrowsedWebsite = {
    startUrl: start.toString(),
    pages,
    pagesVisited: pages.length,
    stoppedEarly: timedOut || queue.length > 0,
    fetchedAt: new Date().toISOString(),
  };

  await audit(ctx, "browse_website", null, {
    startUrl: result.startUrl,
    pagesVisited: result.pagesVisited,
    stoppedEarly: result.stoppedEarly,
  });

  return ok(result);
}
