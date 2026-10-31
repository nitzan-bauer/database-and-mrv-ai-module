import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import { hostAllowed } from "../agent/oneOff/chromeAllow";

export interface ChromePage {
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
}

const MAX_CHARS = 8000;
const WAIT_MS = 45_000;

/**
 * Read one page through the calling agent's OWN dedicated, signed-in Chrome profile on Nitzan's PC.
 *
 * The deployed app cannot see anyone's browser, so this does not drive Chrome itself: it queues a request in
 * mrv.browser_requests and waits for the agent's worker on the PC (web/scripts/agent-chrome-worker.mjs) to
 * answer. Read-only by construction — the worker only opens a page and returns its text — and limited to the
 * domains Nitzan ticked for THIS task (mrv.adhoc_agent_jobs.chrome_domains), checked here and again by the worker.
 */
export async function browseChromeSession(ctx: ToolContext, input: { url: string }): Promise<ToolResult<ChromePage>> {
  const policy = await checkPolicy("browse_chrome_session", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const jobId = ctx.taskParams?.jobId;
  if (!jobId) return fail("browseChromeSession: only available inside a one-off task.");

  let u: URL;
  try {
    u = new URL(input.url);
  } catch {
    return fail(`browseChromeSession: "${input.url}" is not a valid URL.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return fail("browseChromeSession: only http(s) pages.");

  const { query } = await import("../db");
  const jobs = await query<{ chrome_domains: string[]; agent_id: string }>(
    `SELECT chrome_domains, agent_id FROM mrv.adhoc_agent_jobs WHERE job_id = $1`,
    [jobId],
  );
  const job = jobs[0];
  if (!job) return fail("browseChromeSession: unknown job.");
  if (!job.chrome_domains.length) {
    return fail("No signed-in sites were allowed for this task — use fetch_public_url for public pages.");
  }
  if (!hostAllowed(u.hostname, job.chrome_domains)) {
    return fail(`${u.hostname} is not one of the sites Nitzan allowed for this task (${job.chrome_domains.join(", ")}).`);
  }

  const hb = await query<{ fresh: boolean }>(
    `SELECT (now() - last_seen) < interval '40 seconds' AS fresh FROM mrv.browser_worker_heartbeat WHERE agent_id = $1`,
    [job.agent_id],
  );
  if (!hb[0]?.fresh) {
    return fail(
      `The Chrome bridge for ${job.agent_id} is offline (Nitzan's PC or this agent's Chrome is not running). Use public pages instead and say what you could not read.`,
    );
  }

  const ins = await query<{ request_id: string }>(
    `INSERT INTO mrv.browser_requests (job_id, url) VALUES ($1, $2) RETURNING request_id`,
    [jobId, u.toString()],
  );
  const requestId = ins[0].request_id;

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await query<{ status: string; result_title: string | null; result_text: string | null; error: string | null }>(
      `SELECT status, result_title, result_text, error FROM mrv.browser_requests WHERE request_id = $1`,
      [requestId],
    );
    const r = rows[0];
    if (r?.status === "done") {
      const text = r.result_text ?? "";
      await audit(ctx, "browse_chrome_session", { type: "adhoc_agent_job", id: jobId }, { url: u.toString(), chars: text.length });
      return ok({ url: u.toString(), title: r.result_title, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS });
    }
    if (r?.status === "error" || r?.status === "refused") {
      return fail(r.error ?? `The Chrome bridge ${r.status} this request.`);
    }
  }
  return fail("Timed out waiting for the Chrome bridge (45 s).");
}
