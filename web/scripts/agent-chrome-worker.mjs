// One worker per agent, running on Nitzan's PC next to that agent's own dedicated Chrome (see start-agent-chrome.cmd).
//
//   node scripts/agent-chrome-worker.mjs <agentId> <cdpPort>
//
// The deployed app cannot see anyone's browser, so browse_chrome_session (src/lib/tools/browseChromeSession.ts)
// queues a request in mrv.browser_requests and this worker answers it. What it does — and, deliberately, does not:
//   - opens ONE page in the agent's own Chrome profile and returns its visible text (password inputs removed first);
//   - never clicks, types, submits or downloads anything, and never sends cookies or storage anywhere;
//   - refuses anything that is not http(s), a host outside the domains ticked for that job (re-checked here — the
//     app already checked it once), or a page that redirects off those domains;
//   - writes one audit_log row per request and refreshes a heartbeat so the app can tell at once when it is offline.
import fs from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

const [agentId, port] = process.argv.slice(2);
if (!agentId || !/^\d+$/.test(port ?? "")) {
  console.error("usage: node scripts/agent-chrome-worker.mjs <agentId> <cdpPort>");
  process.exit(2);
}

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.replace(/^["']|["']$/g, "");
if (!DATABASE_URL) throw new Error("DATABASE_URL missing in web/.env.local");

// At logon the network can still be coming up — keep trying instead of dying.
let db;
for (;;) {
  try {
    db = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    break;
  } catch (e) {
    console.error(`[${agentId}] database not reachable yet:`, e instanceof Error ? e.message.split("\n")[0] : e);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
console.log(`[${agentId}] worker up — Chrome on 127.0.0.1:${port}`);

const hostAllowed = (host, allowed) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
};

let browser = null;
async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return browser;
}

async function beat() {
  await db.query(
    `INSERT INTO mrv.browser_worker_heartbeat (agent_id, last_seen) VALUES ($1, now())
     ON CONFLICT (agent_id) DO UPDATE SET last_seen = now()`,
    [agentId],
  );
}

async function handleOne() {
  // One worker per agent per PC, so a plain read is enough — no claim step needed.
  const { rows } = await db.query(
    `SELECT r.request_id, r.job_id, r.url, j.chrome_domains
       FROM mrv.browser_requests r JOIN mrv.adhoc_agent_jobs j ON j.job_id = r.job_id
      WHERE r.status = 'queued' AND j.agent_id = $1
      ORDER BY r.created_at LIMIT 1`,
    [agentId],
  );
  if (!rows.length) return false;
  const { request_id, job_id, url, chrome_domains } = rows[0];

  const finish = (status, f) =>
    db.query(
      `UPDATE mrv.browser_requests
          SET status = $2, result_title = $3, result_text = $4, error = $5, answered_at = now()
        WHERE request_id = $1`,
      [request_id, status, f.title ?? null, f.text ?? null, f.error ?? null],
    );

  let outcome = "error";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      await finish("refused", { error: "only http(s) pages" });
      outcome = "refused";
    } else if (!hostAllowed(u.hostname, chrome_domains)) {
      await finish("refused", { error: `${u.hostname} is not an allowed site for this task` });
      outcome = "refused";
    } else {
      const context = (await getBrowser()).contexts()[0];
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        const finalHost = new URL(page.url()).hostname;
        if (!hostAllowed(finalHost, chrome_domains)) {
          await finish("refused", { error: `the page redirected to ${finalHost}, which is not allowed for this task` });
          outcome = "refused";
        } else {
          const text = await page.evaluate(() => {
            document.querySelectorAll("input[type=password]").forEach((e) => e.remove());
            return document.body ? document.body.innerText : "";
          });
          await finish("done", { title: await page.title(), text });
          outcome = "done";
        }
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    await finish("error", { error: e instanceof Error ? e.message : String(e) });
  }

  await db.query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
     VALUES ($1, 'browse_chrome_session', 'adhoc_agent_job', $2, $3::jsonb)`,
    [`agent-chrome-worker:${agentId}`, String(job_id), JSON.stringify({ url, outcome })],
  );
  console.log(`[${agentId}] ${outcome}: ${url}`);
  return true;
}

let lastBeat = 0;
for (;;) {
  try {
    await getBrowser(); // throws until this agent's Chrome is up — and then no heartbeat, so the app sees "offline"
    if (Date.now() - lastBeat > 10_000) {
      await beat();
      lastBeat = Date.now();
    }
    if (!(await handleOne())) await new Promise((r) => setTimeout(r, 3000));
  } catch (e) {
    console.error(`[${agentId}] waiting:`, e instanceof Error ? e.message.split("\n")[0] : e);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
