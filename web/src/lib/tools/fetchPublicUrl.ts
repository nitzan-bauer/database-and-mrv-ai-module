import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";

export interface FetchedPublicUrl {
  url: string;
  status: number;
  title: string | null;
  textExcerpt: string;
  truncated: boolean;
  fetchedAt: string;
  /** Distinct absolute https:// links found on the page (href targets), capped at MAX_LINKS — empty for a non-HTML response. */
  links: string[];
}

const MAX_CHARS = 6000;
const MAX_LINKS = 40;
const FETCH_TIMEOUT_MS = 10_000;

/** Distinct absolute https:// hrefs found in raw HTML, resolved against `base` — no <a> tag parsing library for a shape this simple. */
function extractLinks(html: string, base: URL): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const resolved = new URL(m[1], base);
      if (resolved.protocol === "https:") seen.add(resolved.toString());
    } catch {
      // a malformed href on the page — skip it, not worth failing the whole fetch over
    }
    if (seen.size >= MAX_LINKS) break;
  }
  return [...seen];
}

// Verra's own registry and site are public domain — no API key or account
// needed to browse a project or read a methodology update (confirmed
// directly by Nitzan). What was actually missing was a tool that fetches
// real content instead of a model guessing what a page probably says;
// this is that tool, not a workaround for any access restriction.
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "::1"]);
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

/**
 * Fetch one public URL and return its real, visible text — never a
 * guess about what a page probably contains. Grounds Rebeka's
 * pdd_generator claim ("research every issued PDD in the category on
 * the Verra registry") and John's verra_benchmarking in genuinely
 * fetched content rather than the model's own recollection, which for
 * anything specific to a particular project is exactly the kind of
 * detail an LLM cannot be trusted to remember correctly.
 *
 * https only, and a small blocklist against localhost/private/link-local
 * addresses — this reaches the public internet on the server's behalf,
 * so it must not become a way to reach the server's own internal network.
 */
export async function fetchPublicUrl(
  ctx: ToolContext,
  input: { url: string },
): Promise<ToolResult<FetchedPublicUrl>> {
  const policy = await checkPolicy("fetch_public_url", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return fail(`fetchPublicUrl: "${input.url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    return fail("fetchPublicUrl: only https:// URLs are allowed.");
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || PRIVATE_IP_RE.test(host)) {
    return fail(`fetchPublicUrl: "${host}" is not a public address.`);
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "CarboNature-MRV/1.0 (+https://carbonature.io)" },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    return fail(`fetchPublicUrl: could not reach "${input.url}" — ${e instanceof Error ? e.message : String(e)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();

  let title: string | null = null;
  let text = raw;
  let links: string[] = [];
  if (contentType.includes("html") || /^\s*<!doctype html/i.test(raw)) {
    const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
    title = titleMatch ? titleMatch[1].trim() : null;
    links = extractLinks(raw, parsed);
    text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const truncated = text.length > MAX_CHARS;
  const textExcerpt = truncated ? text.slice(0, MAX_CHARS) : text;

  const result: FetchedPublicUrl = {
    url: parsed.toString(),
    status: res.status,
    title,
    textExcerpt,
    truncated,
    fetchedAt: new Date().toISOString(),
    links,
  };

  await audit(ctx, "fetch_public_url", null, {
    url: result.url,
    status: result.status,
    truncated: result.truncated,
    chars: textExcerpt.length,
  });

  return ok(result);
}
