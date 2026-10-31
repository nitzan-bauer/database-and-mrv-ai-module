# Rebeka One-Off Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "One Off Task" row to Rebeka's *Scheduled Tasks* block. Clicking it opens a window where Nitzan types a prompt (Hebrew or English), attaches files and pastes links; Rebeka then works on it for real (multi-step, with her own tools), and the result lands on screen and as a letterhead report by email. **Everything she produces — findings, conclusions, summaries, documents — is stored in her long-term memory and filed in the right Drive folders, and every task (plus Nitzan's feedback on it) makes her better at the next one.** Phase 5 gives her read-only access to the sites Nitzan keeps open in Chrome.

**Architecture:** A new `manual` scheduled-task row (`rebeka_one_off_task`) reuses the existing Run-Now bookkeeping (`runScheduledTaskNow` → `last_run_*` + audit log). The prompt/files/links are saved as a *job row* (`mrv.adhoc_agent_jobs`); a server action creates the job and kicks a dedicated route (`maxDuration = 280`, work runs inside `after()`), so the run is **not** held to the 60 s page limit. A bounded multi-step loop (`runAgentJob`) calls Rebeka's own tools one at a time — every call still goes through `checkPolicy`/`audit`, confirm-gated tools stop the job and land in `/agents/approvals`. The popup polls the job and shows progress, then the final answer. **Before** a run she *recalls* her past lessons, cross-agent lessons and relevant stored memories; **after** it she *learns* (atomic findings/conclusions saved to long-term memory, a lesson distilled from what worked and failed) and *files* the work in Drive (`One-off tasks / <topic> / <date — title>`, plus a shortcut in the farm's own folder when a farm is involved); Nitzan's verdict on the answer (useful / needs correction / wrong) is recorded and immediately turned into a lesson, so the very next task reads it.

**Tech Stack:** Next.js 16 (App Router, Server Actions, `after()`), React 19, Postgres (`mrv` schema, migrations via `node scripts/db-migrate.mjs`), Anthropic provider (`ModelProvider.complete`), `pdf-lib` letterhead, `node:test` for the pure-logic tests (no test framework exists in `web/` today).

---

## Implementation status — built 2026-10-31 (read this first)

Nitzan approved the Drive layout (D5), asked for the task to sit **last** in each panel, and extended the scope: **the identical feature for all five agents, each with its own dedicated Chrome.** What was built, and where it differs from the plan below:

- **All five agents** (`rebeka`, `dave`, `john`, `ron`, `jennifer`): task key `<agent>_one_off_task`, placed last (`ORDER BY` in `lib/data/index.ts`). Pure helpers `oneOffTaskKey` / `agentIdFromOneOffKey` / `domainForAgent` in `jobInput.ts`; one shared loop, memory, Drive and report code driven by `job.agentId`.
- **Migrations 0128 + 0129** are applied to the shared DB. 0128 carries `chrome_domains` on the job table directly (the plan added it in 0129) and seeds the five manual task rows; 0129 adds the bridge queue, a **per-agent** heartbeat, and the `browse_chrome_session` tool + policy on all five agents.
- **Per-agent Chrome:** ports `9222` rebeka · `9223` dave · `9224` john · `9225` ron · `9226` jennifer, profiles under `%USERPROFILE%\.carbonature-agent-chrome\<agent>`. Files: `web/scripts/agent-chrome-worker.mjs`, `start-agent-chrome.cmd`, `start-all-agent-chromes.cmd` (the plan's single-agent names were generalised).
- **Auto-start at logon uses the Startup folder, not `schtasks`** — `schtasks /Create` returned *Access is denied* without elevation. File: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CarboNature Agent Chromes.cmd` (waits 25 s, then starts all five). Delete it to switch the whole thing off.
- **Run path:** the server action builds the route URL from the request's own host (works on `localhost:3007` and in production) instead of an env variable.
- **Subject line:** `subjectFor` keeps only whole Latin words (a first version left stray punctuation for Hebrew prompts — found in the live run, fixed, tested).
- **Tests:** `npm run test:unit` → 14 `node:test` cases (pure modules). Verified live: Rebeka (Hebrew, recall + memory + Drive + email), Dave (tool step, and a page read through his own Chrome), Ron (CRM domain); the bridge worker's allow/refuse paths against a throwaway headless Chrome. All test rows were deleted by id; the test Drive folders are in the Drive trash. The popup UI itself was type-checked and linted but **not** viewed in a browser (it needs Nitzan's Google sign-in).

## What I found in the code (facts the design rests on)

| Fact | Where | Consequence |
|---|---|---|
| The Scheduled Tasks popup + "Run Now" already exist; `Run Now` calls a server action. A task with `frequency='manual'` is never picked up by cron. | `web/src/components/agents/ScheduledTasksPanel.tsx`, `lib/agent/runScheduledTaskNowAction.ts`, migration `0122` | New row = one migration + one registry entry. Dave's email-ingestion popup already special-cases the popup body (`task_needsFarmPicker`) — same hook for our form. |
| Server actions on `/agents/[agentId]` run under `maxDuration = 60`. The cron route uses `maxDuration = 280` and a 240 s per-handler timeout. | `app/(module)/agents/[agentId]/page.tsx:25`, `app/api/cron/run-scheduled-tasks/route.ts:18`, `runScheduledTaskNow.ts:25` | A real research task cannot run inside the server action. It must run in its own route with `maxDuration = 280`. |
| `runAgentTask` is **single-step by design** (one model call, at most one tool call). | `lib/agent/runAgentTask.ts:91` | A one-off task needs a bounded loop; the provider only accepts one `userMessage`, so the loop re-prompts with an accumulating "work so far" log (no provider change). |
| "Ask Rebeka" chat already reads attachments server-side (`.txt .csv .tsv .json .md .log .yaml .docx .xlsx .pdf`, 100 k chars cap) and the provider supports images. | `lib/agent/extractAttachmentText.ts`, `provider.ts` `images` | Reuse `extractAttachmentText` as-is for files. |
| Rebeka already holds `fetch_public_url`, `browse_website`, `search_verra_registry`, `download_related_pdds`, `draft_pdd_chapter_content`, `send_email`, `record_agent_memory`, … | `mrv.agents.tools` (queried live) | Links need no new tool: the loop gives the model the URLs and `fetch_public_url`. Anthropic web search is available through `provider.complete({ webSearch })`. |
| The report step (memory + DB row + letterhead PDF + email) is one function. | `lib/reports/scheduledTaskReport.ts` `finishScheduledTask` | Reuse it with `taskKey: "rebeka_one_off_task"`. |
| **The letterhead PDF uses `StandardFonts.Helvetica` — it cannot print Hebrew.** | `lib/reports/letterheadPdf.ts:201` | If the prompt is Hebrew and Rebeka answers in Hebrew, the PDF would break/blank. Decision D2 below. |
| `finishScheduledTask` already (1) writes the whole report to her memory, (2) distils a lesson, (3) inserts a DB row, (4) emails the PDF, (5) uploads the PDF **flat** into her Drive folder root. | `lib/reports/scheduledTaskReport.ts:48-140` | Memory/lesson/Drive are partly free. Missing for a one-off: atomic findings/conclusions in memory, **recall before the run**, human feedback, and Drive filing into topic/date subfolders. |
| Learning here is in-context, not fine-tuning: `recordLesson` → `recallLessons` / `recallDomainLessons`, plus human verdicts in `mrv.agent_feedback` (`recordAgentFeedback`, human-only). | `lib/agent/lessonMemory.ts`, `lib/tools/recordAgentFeedback.ts` | "She improves" means the next run *reads* the lessons and corrections. The chat path (`runAgentTask`) recalls them; the loop must too (Task 4b). |
| Drive helpers exist: `ensureSubfolder` (find-or-create), `uploadFileToDriveFolder`, `createDriveShortcut`. Rebeka's folder is linked (`mrv.agents.drive_folder_id`, verified in the DB 2026-10-18); farms have `mrv.farms.drive_folder_id`. Her `rebeka_drive_digestion` task re-reads that folder into memory. | `lib/google/driveClient.ts`, migrations `0032`, `0107` | Filing needs no new Google code, and what she saves is re-digested later, closing the loop. |
| **`browse_website` / `fetch_public_url` fetch *public* pages from the server** (SSRF-guarded, no cookies, no login). The deployed app runs on Vercel and cannot see Nitzan's Chrome. | `lib/tools/browseWebsite.ts`, `fetchPublicUrl.ts` | "Access to the sites open in Chrome" is **not** possible with today's tools — Claude Code can drive his Chrome, Rebeka on Vercel cannot. Phase 5 builds a bridge. |
| Since Chrome 136 the `--remote-debugging-port` flag is ignored for the *default* profile. | Chrome security change | The bridge cannot attach to his everyday profile; it needs a dedicated "Rebeka" Chrome profile he signs in to once (cookies persist). |
| `send_email` is policy `auto` and only ever mails nitzan@carbonature.io. Confirm-gated for Rebeka: `compile_eligibility_evidence_pack`, `export_plots_kmz`, `generate_pdd_draft`, `run_pdd_generator_pipeline`, `submit_project_status`, `sync_pdd_google_doc`. | migration `0095`, `mrv.agent_action_policies` (queried live) | The approval-stop test uses `generate_pdd_draft`, not email. |
| Panel list is `ORDER BY task_key`; the card label is derived from the key (`rebeka_one_off_task` → "One Off Task"). | `lib/data/index.ts:1235-1258` | The new row sorts between "Monthly Product Research" and "Weekly …". Easy to move if you want it first/last. |
| Vercel Hobby, push to `main` auto-deploys (verified 2026-10-18). Repo's long-running work elsewhere uses GitHub Actions. | `.github/workflows/*`, memory | Route-in-Vercel first; GitHub Actions is the escape hatch for jobs longer than ~4.5 minutes (Phase 3, optional). |

## Decisions that need Nitzan's answer before building

- **D1 – Where the long run executes.** Recommended: a Vercel route with `maxDuration = 280` (≈2.5 min of research plus wrap-up — memory, report, Drive — inside the existing 240 s handler cap; no new secrets, same pattern as the cron). If you expect tasks that run longer (e.g. "download and analyse 20 PDDs"), Phase 3 adds a GitHub-Actions runner. *Recommendation: ship Phase 1–2 now, add Phase 3 only if a real task hits the ceiling.*
- **D2 – Language of the report.** Options: (a) the answer is in the prompt's language on screen, in the email body, in Drive (`report.md`) and in memory; the letterhead PDF carries it only when it is Latin-script — for a Hebrew answer the PDF holds a one-line English pointer instead of a page of `?????` (the PDF builder maps unencodable glyphs to `?`) — zero risk, shipped in Phase 1; (b) Phase 4 embeds a Hebrew font (Heebo) with right-to-left layout so a Hebrew prompt gets a Hebrew letterhead PDF. *Recommendation: (a) now, (b) as its own task.*
- **D3 – What may she do on her own.** The job runs under Rebeka's *existing* per-action policies. Anything marked `confirm` (`generate_pdd_draft`, `run_pdd_generator_pipeline`, `submit_project_status`, `sync_pdd_google_doc`, `export_plots_kmz`, `compile_eligibility_evidence_pack`) is **not** executed — the job stops with status `needs_approval` and the action waits in `/agents/approvals`, exactly like today's chat. Everything `auto` (research, reading, memory, Drive filing, the email report to you) just runs. Say if you want something different.
- **D4 – "Access to the sites open in Chrome".** Today that access belongs to Claude Code, not to Rebeka: she runs on Vercel and only sees public pages. Options: (a) public pages + web search only — works in Phase 1, no setup; (b) **a Chrome bridge (Phase 5)**: a small worker on your PC drives a dedicated "Rebeka Chrome" profile that you sign in to once; it is **read-only** (open page, read text — no clicking, typing or submitting), limited to the domains you tick for that task, and works only while the PC is on. (c) Giving her passwords — rejected. *Recommendation: (a) now, (b) once Phase 1 is proven; Phase 5 starts with a one-hour spike to pick the mechanism.*
- **D5 – Drive layout.** `Rebeka's folder / One-off tasks / <topic> / <YYYY-MM-DD — title> /` holding `report.pdf`, `report.md`, `request.md`, `sources.md`, `attachments/*.txt`. Topics: `PDD`, `Verra & Registry`, `Market & Credits`, `Methodology`, `General`. When the answer concerns a named farm, a shortcut to the same folder is also placed in that farm's Drive folder. Confirm or change the topic list.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `migrations/0128_rebeka_one_off_task.sql` | create | `mrv.adhoc_agent_jobs` table + the `manual` task row |
| `web/src/lib/agent/oneOff/jobInput.ts` | create | **Pure** (no server imports): validate links, cap attachments, build the agent's task prompt, parse its end-of-run signal |
| `web/src/lib/agent/oneOff/jobStore.ts` | create | DB access: create/get/update job, append progress |
| `web/src/lib/agent/oneOff/runAgentJob.ts` | create | The bounded multi-step loop over Rebeka's tools; ends with `finishScheduledTask` |
| `web/src/lib/agent/oneOff/recall.ts` | create | Before a run: recall her lessons, cross-agent lessons and relevant memories → a prompt block |
| `web/src/lib/agent/oneOff/learnFromJob.ts` | create | After a run: atomic findings/conclusions → long-term memory; a richer lesson |
| `web/src/lib/agent/oneOff/fileJobToDrive.ts` | create | Drive filing: topic/date folder, request, sources, attachments, farm shortcut |
| `web/src/lib/reports/scheduledTaskReport.ts` | modify | optional `driveSubfolders` so the PDF lands in the job's folder instead of the folder root |
| `web/src/lib/agent/oneOff/oneOffActions.ts` | create | Server actions: `startOneOffJobAction`, `getOneOffJobAction`, `rateOneOffJobAction` (feedback) |
| `web/src/app/api/agents/one-off/run/route.ts` | create | `maxDuration = 280` route that does the actual run inside `after()` |
| `web/src/components/agents/OneOffTaskForm.tsx` | create | The popup form: prompt, files, links, progress, result |
| `web/src/components/agents/ScheduledTasksPanel.tsx` | modify | Render the form for `rebeka_one_off_task` instead of the Run-Now body |
| `web/src/lib/agent/scheduledTaskRegistry.ts` | modify | Register `rebeka_one_off_task` handler (runs a job by `taskParams.jobId`) |
| `web/tests/oneOffJobInput.test.mts` | create | `node --test` for the pure module |

Everything outside `web/src/lib/agent/oneOff/` is a small, additive change.

---

## Phase 1 — Working end to end (English/Hebrew prompt, files, links, result on screen + email)

### Task 1: Pure input module (validation, caps, prompt) — with tests

**Files:**
- Create: `web/src/lib/agent/oneOff/jobInput.ts`
- Test: `web/tests/oneOffJobInput.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/oneOffJobInput.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLinks,
  capAttachments,
  buildTaskPrompt,
  parseRoutingBlock,
  parseMemoryItems,
  topicFolderPath,
  pdfParagraphsFor,
  subjectFor,
  MAX_LINKS,
  MAX_TOTAL_ATTACHMENT_CHARS,
} from "../src/lib/agent/oneOff/jobInput.ts";

test("normalizeLinks keeps only http(s), dedupes, trims, caps the count", () => {
  const out = normalizeLinks([
    " https://verra.org/a ",
    "https://verra.org/a",
    "ftp://x.org/file",
    "javascript:alert(1)",
    "not a url",
    "http://example.com/b",
  ]);
  assert.deepEqual(out.links, ["https://verra.org/a", "http://example.com/b"]);
  assert.equal(out.rejected.length, 3);
  const many = normalizeLinks(Array.from({ length: MAX_LINKS + 5 }, (_, i) => `https://e.com/${i}`));
  assert.equal(many.links.length, MAX_LINKS);
});

test("capAttachments truncates to the total budget and reports it", () => {
  const big = "x".repeat(MAX_TOTAL_ATTACHMENT_CHARS);
  const out = capAttachments([
    { name: "a.txt", text: big, truncated: false },
    { name: "b.txt", text: "second file", truncated: false },
  ]);
  const total = out.attachments.reduce((n, a) => n + a.text.length, 0);
  assert.ok(total <= MAX_TOTAL_ATTACHMENT_CHARS);
  assert.equal(out.droppedNames.includes("b.txt") || out.attachments[1]?.truncated === true, true);
});

test("buildTaskPrompt carries the prompt verbatim, every link and every file", () => {
  const p = buildTaskPrompt({
    prompt: "תבדוק את הפרויקט הזה ותסכם",
    links: ["https://verra.org/a"],
    attachments: [{ name: "plan.pdf", text: "PLAN BODY", truncated: false }],
  });
  assert.match(p, /תבדוק את הפרויקט הזה ותסכם/);
  assert.match(p, /https:\/\/verra\.org\/a/);
  assert.match(p, /plan\.pdf/);
  assert.match(p, /PLAN BODY/);
  assert.match(p, /same language as the request/i);
  assert.match(p, /ROUTING:/);
});

test("parseRoutingBlock splits the trailing ROUTING line off the answer", () => {
  const r = parseRoutingBlock('Summary text.\n\nROUTING: {"topic":"verra","farm":"Ontilili Farm"}');
  assert.equal(r.body, "Summary text.");
  assert.deepEqual(r.routing, { topic: "verra", farm: "Ontilili Farm" });
});

test("parseRoutingBlock falls back to general / no farm on a missing or garbage line", () => {
  assert.deepEqual(parseRoutingBlock("Just text").routing, { topic: "general", farm: null });
  assert.deepEqual(parseRoutingBlock('x\nROUTING: {"topic":"nonsense","farm":""}').routing, { topic: "general", farm: null });
});

test("parseMemoryItems accepts fenced JSON, drops unknown kinds and empties, caps at 8", () => {
  const raw =
    '```json\n[{"kind":"finding","text":"A"},{"kind":"bogus","text":"B"},{"kind":"conclusion","text":"  "},' +
    Array.from({ length: 12 }, (_, i) => `{"kind":"source","text":"S${i}"}`).join(",") +
    "]\n```";
  const items = parseMemoryItems(raw);
  assert.equal(items.length, 8);
  assert.deepEqual(items[0], { kind: "finding", text: "A" });
  assert.deepEqual(parseMemoryItems("not json"), []);
});

test("topicFolderPath is three levels and strips characters Drive/Windows dislike", () => {
  const p = topicFolderPath({ topic: "verra", farm: null }, 'Review: "VM0042" <draft>/v2?', "2026-10-31T09:00:00.000Z");
  assert.deepEqual(p.slice(0, 2), ["One-off tasks", "Verra & Registry"]);
  assert.match(p[2], /^2026-10-31 — Review VM0042 draftv2$/);
});

test("pdfParagraphsFor keeps Latin paragraphs and swaps Hebrew ones for a single English pointer", () => {
  const out = pdfParagraphsFor(["Intro in English.", "תוצאה בעברית", "עוד פסקה", "Closing."]);
  assert.equal(out.length, 3);
  assert.equal(out[0], "Intro in English.");
  assert.match(out[1], /Hebrew text/);
  assert.equal(out[2], "Closing.");
});

test("subjectFor is ASCII-safe and falls back to the job id for a Hebrew-only prompt", () => {
  assert.equal(subjectFor("בדיקה", "2026-10-31T09:00:00Z", "abcdef12-0000"), "One-off task — 2026-10-31 — abcdef12");
  assert.match(subjectFor("Check VM0042 status", "2026-10-31T09:00:00Z", "x"), /Check VM0042 status$/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `web/`): `node --test tests/oneOffJobInput.test.mts`
Expected: FAIL — `Cannot find module '../src/lib/agent/oneOff/jobInput.ts'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// web/src/lib/agent/oneOff/jobInput.ts
// Pure module: no "server-only", no path aliases, no DB — so `node --test` can load it directly.

export const ONE_OFF_TASK_KEY = "rebeka_one_off_task";
export const MAX_LINKS = 10;
export const MAX_TOTAL_ATTACHMENT_CHARS = 150_000;

export const TOPICS = ["pdd", "verra", "market", "methodology", "general"] as const;
export type Topic = (typeof TOPICS)[number];
export const TOPIC_FOLDER_NAMES: Record<Topic, string> = {
  pdd: "PDD",
  verra: "Verra & Registry",
  market: "Market & Credits",
  methodology: "Methodology",
  general: "General",
};
export interface Routing {
  topic: Topic;
  farm: string | null;
}

export interface JobAttachment {
  name: string;
  text: string;
  truncated: boolean;
}

export function normalizeLinks(raw: string[]): { links: string[]; rejected: string[] } {
  const links: string[] = [];
  const rejected: string[] = [];
  for (const item of raw) {
    const s = item.trim();
    if (!s) continue;
    let ok = false;
    try {
      const u = new URL(s);
      ok = u.protocol === "https:" || u.protocol === "http:";
    } catch {
      ok = false;
    }
    if (!ok) {
      rejected.push(s);
      continue;
    }
    if (links.includes(s)) continue;
    if (links.length >= MAX_LINKS) {
      rejected.push(s);
      continue;
    }
    links.push(s);
  }
  return { links, rejected };
}

export function capAttachments(input: JobAttachment[]): { attachments: JobAttachment[]; droppedNames: string[] } {
  const attachments: JobAttachment[] = [];
  const droppedNames: string[] = [];
  let left = MAX_TOTAL_ATTACHMENT_CHARS;
  for (const a of input) {
    if (left <= 0) {
      droppedNames.push(a.name);
      continue;
    }
    if (a.text.length <= left) {
      attachments.push(a);
      left -= a.text.length;
    } else {
      attachments.push({ name: a.name, text: a.text.slice(0, left), truncated: true });
      left = 0;
    }
  }
  return { attachments, droppedNames };
}

export function buildTaskPrompt(input: { prompt: string; links: string[]; attachments: JobAttachment[] }): string {
  const parts: string[] = [
    "ONE-OFF TASK from Nitzan (CEO). Do exactly what is asked; do not start unrelated work.",
    "Reply, and write any report, in the same language as the request (Hebrew or English).",
    "Use only what the sources actually say; if something cannot be verified, say so plainly.",
    "Finish your final answer with exactly one last line: " +
      `ROUTING: {"topic": "${TOPICS.join(" | ")}", "farm": "<exact farm name, or null>"} — choose the one topic the work belongs to.`,
    "",
    "REQUEST:",
    input.prompt.trim(),
  ];
  if (input.links.length) {
    parts.push("", "LINKS TO READ (use fetch_public_url or browse_website on each before relying on it):");
    for (const l of input.links) parts.push(`- ${l}`);
  }
  for (const a of input.attachments) {
    parts.push("", `ATTACHED FILE: ${a.name}${a.truncated ? " (truncated)" : ""}`, a.text);
  }
  return parts.join("\n");
}

/** Splits the trailing `ROUTING: {...}` line off the model's final answer. Anything unparseable → topic "general", no farm. */
export function parseRoutingBlock(text: string): { body: string; routing: Routing } {
  const fallback: Routing = { topic: "general", farm: null };
  const m = text.match(/\n?[ \t]*ROUTING:[ \t]*(\{[^\n]*\})[ \t]*$/);
  if (!m || m.index === undefined) return { body: text.trim(), routing: fallback };
  let routing = fallback;
  try {
    const j = JSON.parse(m[1]) as { topic?: string; farm?: string | null };
    const topic = (TOPICS as readonly string[]).includes(String(j.topic)) ? (j.topic as Topic) : "general";
    routing = { topic, farm: typeof j.farm === "string" && j.farm.trim() ? j.farm.trim() : null };
  } catch {
    routing = fallback;
  }
  return { body: text.slice(0, m.index).trim(), routing };
}

const MEMORY_KINDS = ["finding", "conclusion", "source", "open_question"];
export const MAX_MEMORY_ITEMS = 8;

/** The memory-clerk model call returns a JSON array, sometimes fenced. Keep only well-formed, known-kind, non-empty items. */
export function parseMemoryItems(raw: string): Array<{ kind: string; text: string }> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Array<{ kind: string; text: string }> = [];
  for (const it of arr) {
    const kind = (it as { kind?: unknown })?.kind;
    const text = (it as { text?: unknown })?.text;
    if (typeof kind !== "string" || typeof text !== "string") continue;
    if (!MEMORY_KINDS.includes(kind) || !text.trim()) continue;
    out.push({ kind, text: text.trim() });
    if (out.length >= MAX_MEMORY_ITEMS) break;
  }
  return out;
}

/** Drive path under Rebeka's own folder: One-off tasks / <topic> / <date — title>. */
export function topicFolderPath(routing: Routing, prompt: string, createdAtIso: string): string[] {
  const day = createdAtIso.slice(0, 10);
  const title =
    prompt.trim().replace(/\s+/g, " ").replace(/[\\/:*?"<>|]/g, "").slice(0, 60).trim() || "task";
  return ["One-off tasks", TOPIC_FOLDER_NAMES[routing.topic], `${day} — ${title}`];
}

const HEBREW = /[֐-׿]/;

/**
 * The letterhead PDF is built with Helvetica/WinAnsi (lib/reports/letterheadPdf.ts) and prints any other glyph as "?".
 * Until Phase 4 embeds a Hebrew font, Hebrew paragraphs are replaced in the PDF by one English pointer — the full
 * text still goes out in the email body, into Drive (report.md) and onto the screen.
 */
export function pdfParagraphsFor(paragraphs: string[]): string[] {
  const out: string[] = [];
  let pointerAdded = false;
  for (const p of paragraphs) {
    if (!HEBREW.test(p)) {
      out.push(p);
    } else if (!pointerAdded) {
      out.push(
        "[Hebrew text - the PDF letterhead cannot print Hebrew yet. The full report is in this email's body, in Drive (report.md) and on the Rebeka page.]",
      );
      pointerAdded = true;
    }
  }
  return out;
}

/** Email subject and PDF title: Latin characters only, so a Hebrew prompt never turns the title into "?????". */
export function subjectFor(prompt: string, createdAtIso: string, jobId: string): string {
  const ascii = prompt.trim().replace(/\s+/g, " ").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 60);
  return `One-off task — ${createdAtIso.slice(0, 10)} — ${ascii || jobId.slice(0, 8)}`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test tests/oneOffJobInput.test.mts`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/agent/oneOff/jobInput.ts web/tests/oneOffJobInput.test.mts
git commit -m "feat(rebeka): pure input module for one-off tasks (links, attachment caps, prompt)"
```

### Task 2: Migration — job table + the manual task row

**Files:**
- Create: `migrations/0128_rebeka_one_off_task.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrate:up
-- =====================================================================
-- 0128 — Nitzan (chat, 2026-10-31): run Rebeka on a one-off task from
-- her Scheduled Tasks block — type a prompt (Hebrew/English), attach
-- files, paste links. A 'manual' task row (never picked up by cron, like
-- dave_email_activity_ingestion in 0122) plus a job table that carries
-- the request, the live progress and the final answer.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.adhoc_agent_jobs (
  job_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      text NOT NULL REFERENCES mrv.agents(agent_id),
  requested_by  text NOT NULL,
  prompt        text NOT NULL,
  links         text[] NOT NULL DEFAULT '{}',
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{name, text, truncated}] — extracted text only, never the raw file
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'needs_approval', 'error')),
  progress      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{at, step, tool, summary}]
  result_text   text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_adhoc_agent_jobs_agent ON mrv.adhoc_agent_jobs (agent_id, created_at DESC);
COMMENT ON TABLE mrv.adhoc_agent_jobs IS
  'One row per one-off agent task started from a Scheduled Tasks popup (first user: Rebeka, 0128). Holds the request, live progress and the final answer.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, next_run_at)
VALUES ('rebeka', 'rebeka_one_off_task',
        'Run Rebeka on a one-off task: a prompt in Hebrew or English, with attached files and links',
        'manual', '9999-12-31T00:00:00Z')
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'rebeka_one_off_task';
DROP TABLE IF EXISTS mrv.adhoc_agent_jobs;
```

- [ ] **Step 2: Dry-run, then check the schema gate**

Run (from `web/`): `node scripts/db-migrate.mjs` (dry run lists `0128` as pending), then `npm run check:sql`
Expected: `0128_rebeka_one_off_task.sql` pending; check:sql passes.

- [ ] **Step 3: Apply (the DB is the shared live Supabase — the migration only adds a table and a row)**

Run: `node scripts/db-migrate.mjs --apply`
Expected: `applied 0128_rebeka_one_off_task.sql`. Then verify: the row exists with `frequency = 'manual'`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0128_rebeka_one_off_task.sql
git commit -m "feat(rebeka): migration 0128 — one-off task row and adhoc_agent_jobs table"
```

### Task 3: Job store (DB access)

**Files:**
- Create: `web/src/lib/agent/oneOff/jobStore.ts`

- [ ] **Step 1: Write the store**

```ts
// web/src/lib/agent/oneOff/jobStore.ts
import "server-only";
import type { JobAttachment } from "./jobInput";

export type JobStatus = "queued" | "running" | "done" | "needs_approval" | "error";

export interface ProgressEntry {
  at: string;
  step: number;
  tool: string | null;
  summary: string;
}

export interface OneOffJob {
  jobId: string;
  agentId: string;
  requestedBy: string;
  prompt: string;
  links: string[];
  attachments: JobAttachment[];
  status: JobStatus;
  progress: ProgressEntry[];
  resultText: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function rowToJob(r: Record<string, unknown>): OneOffJob {
  return {
    jobId: String(r.job_id),
    agentId: String(r.agent_id),
    requestedBy: String(r.requested_by),
    prompt: String(r.prompt),
    links: (r.links as string[]) ?? [],
    attachments: (r.attachments as JobAttachment[]) ?? [],
    status: r.status as JobStatus,
    progress: (r.progress as ProgressEntry[]) ?? [],
    resultText: (r.result_text as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    finishedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
  };
}

export async function createJob(input: {
  agentId: string;
  requestedBy: string;
  prompt: string;
  links: string[];
  attachments: JobAttachment[];
}): Promise<string> {
  const { query } = await import("../../db");
  const rows = await query<{ job_id: string }>(
    `INSERT INTO mrv.adhoc_agent_jobs (agent_id, requested_by, prompt, links, attachments)
     VALUES ($1, $2, $3, $4::text[], $5::jsonb) RETURNING job_id`,
    [input.agentId, input.requestedBy, input.prompt, input.links, JSON.stringify(input.attachments)],
  );
  return rows[0].job_id;
}

export async function getJob(jobId: string): Promise<OneOffJob | null> {
  const { query } = await import("../../db");
  const rows = await query<Record<string, unknown>>(`SELECT * FROM mrv.adhoc_agent_jobs WHERE job_id = $1`, [jobId]);
  return rows.length ? rowToJob(rows[0]) : null;
}

export async function markRunning(jobId: string): Promise<boolean> {
  const { query } = await import("../../db");
  // Only a 'queued' job may start — a second trigger for the same job is a no-op, never a double run.
  const rows = await query<{ job_id: string }>(
    `UPDATE mrv.adhoc_agent_jobs SET status = 'running', started_at = clock_timestamp()
      WHERE job_id = $1 AND status = 'queued' RETURNING job_id`,
    [jobId],
  );
  return rows.length === 1;
}

export async function appendProgress(jobId: string, entry: ProgressEntry): Promise<void> {
  const { query } = await import("../../db");
  await query(
    `UPDATE mrv.adhoc_agent_jobs SET progress = progress || $2::jsonb WHERE job_id = $1`,
    [jobId, JSON.stringify([entry])],
  );
}

export async function finishJob(
  jobId: string,
  outcome: { status: "done" | "needs_approval" | "error"; resultText?: string; error?: string },
): Promise<void> {
  const { query } = await import("../../db");
  await query(
    `UPDATE mrv.adhoc_agent_jobs
        SET status = $2, result_text = $3, error = $4, finished_at = clock_timestamp()
      WHERE job_id = $1`,
    [jobId, outcome.status, outcome.resultText ?? null, outcome.error ?? null],
  );
}
```

- [ ] **Step 2: Type-check**

Run (from `web/`): `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/agent/oneOff/jobStore.ts
git commit -m "feat(rebeka): job store for one-off tasks"
```

### Task 4: The bounded multi-step loop

**Files:**
- Create: `web/src/lib/agent/oneOff/runAgentJob.ts`
- Modify: `web/src/lib/agent/scheduledTaskRegistry.ts`

Design notes the code below follows:
- Max **8 steps** and a **140 s** research budget. The 240 s handler cap must also hold the wrap-up that follows (letterhead report ≈ 25 s, then memory + Drive filing running in parallel ≈ 60 s), so research stops at 140 s. Each model call gets `min(55 s, time left)`.
- Before the first step the loop **recalls** (Task 4b); after the final answer it **reports, learns and files** (Tasks 4c, 4d). Progress entry `step 0` records how many lessons/memories were recalled, so the learning is visible in the popup.
- Each step: one `provider.complete` with the *task prompt + a "work so far" log*; a `text` answer ends the run (that text is the final report); a `tool_call` runs through `TOOL_REGISTRY[name].handler(ctx, input)` — the same function `runAgentTask` uses, so `checkPolicy`/`audit` apply unchanged.
- Only tools in `agent.tools` are offered or accepted (same defence in depth as `runAgentTask`).
- `needsConfirmation` → persist to `mrv.pending_agent_actions` (same insert as `runAgentTask`), stop, status `needs_approval`.
- Web search is enabled on the model call so a research prompt can search the open web.

- [ ] **Step 1: Write the loop**

```ts
// web/src/lib/agent/oneOff/runAgentJob.ts
import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import {
  buildTaskPrompt,
  ONE_OFF_TASK_KEY,
  parseRoutingBlock,
  pdfParagraphsFor,
  subjectFor,
  topicFolderPath,
} from "./jobInput";
import { appendProgress, finishJob, getJob, markRunning } from "./jobStore";

export const TASK_KEY = ONE_OFF_TASK_KEY;

const MAX_STEPS = 8;
const TOTAL_BUDGET_MS = 140_000;
const STEP_TIMEOUT_MS = 55_000;
const WORK_LOG_CHAR_LIMIT = 12_000;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… [clipped]` : s;
}

export async function runAgentJob(ctx: ToolContext, jobId: string): Promise<ScheduledTaskOutcome> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, detail: `No one-off job ${jobId}.` };
  if (!(await markRunning(jobId))) {
    return { ok: false, detail: `Job ${jobId} is already ${job.status} — not started twice.` };
  }

  const { getAgent } = await import("../../data");
  const { getConfiguredProvider } = await import("../provider");
  const { TOOL_REGISTRY } = await import("../toolRegistry");
  const agent = await getAgent(job.agentId);
  if (!agent) {
    await finishJob(jobId, { status: "error", error: `No such agent: ${job.agentId}` });
    return { ok: false, detail: `No such agent: ${job.agentId}` };
  }

  const provider = await getConfiguredProvider();
  const schemas = agent.tools
    .map((name) => TOOL_REGISTRY[name]?.schema)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const basePrompt = buildTaskPrompt({ prompt: job.prompt, links: job.links, attachments: job.attachments });

  const { recallForJob } = await import("./recall");
  const recalled = await recallForJob(ctx, job.prompt);
  await appendProgress(jobId, {
    at: new Date().toISOString(),
    step: 0,
    tool: "recall",
    summary: `Recalled ${recalled.lessons} lesson(s) and ${recalled.memories} stored note(s) before starting.`,
  });

  const started = Date.now();
  let workLog = "";
  let finalText: string | null = null;
  const toolsUsed: string[] = [];
  const failures: string[] = [];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const left = TOTAL_BUDGET_MS - (Date.now() - started);
      if (left < 10_000) break;

      const userMessage = workLog
        ? `${basePrompt}\n\n--- WORK SO FAR (your own earlier steps this run) ---\n${workLog}\n\nContinue. Call one tool if you still need to, otherwise reply with the final answer for Nitzan.`
        : basePrompt;

      const resp = await provider.complete({
        system: agent.rolePrompt + recalled.block,
        userMessage,
        tools: schemas,
        webSearch: { maxUses: 3, timeoutMs: Math.min(STEP_TIMEOUT_MS, left) },
        timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
        maxTokens: 8192,
      });

      if (resp.kind === "text") {
        finalText = resp.text.trim();
        await appendProgress(jobId, { at: new Date().toISOString(), step, tool: null, summary: "Wrote the final answer." });
        break;
      }

      const name = resp.call.name;
      const entry = TOOL_REGISTRY[name];
      if (!entry || !agent.tools.includes(name)) {
        workLog += `\nStep ${step}: you tried "${name}", which you do not hold. Use only your own tools.\n`;
        continue;
      }

      const result = await entry.handler(ctx, resp.call.input);
      if (!result.ok && result.needsConfirmation) {
        const { query } = await import("../../db");
        await query(
          `INSERT INTO mrv.pending_agent_actions (agent_id, action_name, input, reason, requested_by)
           VALUES ($1, $2, $3::jsonb, $4, $5)`,
          [job.agentId, name, JSON.stringify(resp.call.input), result.error, job.requestedBy],
        );
        await appendProgress(jobId, { at: new Date().toISOString(), step, tool: name, summary: `Held for approval: ${result.error}` });
        await finishJob(jobId, {
          status: "needs_approval",
          resultText: `Stopped at step ${step}: "${name}" needs a manager's approval (see /agents/approvals). ${workLog ? "Work so far:\n" + clip(workLog, 3000) : ""}`,
        });
        return { ok: true, detail: `One-off task paused: ${name} awaits approval.` };
      }

      toolsUsed.push(name);
      if (!result.ok) failures.push(`${name}: ${clip(result.error, 200)}`);
      const summary = result.ok
        ? `${name} succeeded: ${clip(JSON.stringify(result.data), 1500)}`
        : `${name} failed: ${result.error}`;
      workLog = clip(`${workLog}\nStep ${step}: ${summary}\n`, WORK_LOG_CHAR_LIMIT);
      await appendProgress(jobId, { at: new Date().toISOString(), step, tool: name, summary: clip(summary, 300) });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishJob(jobId, { status: "error", error: message });
    return { ok: false, detail: `One-off task failed: ${message}` };
  }

  if (!finalText) {
    const partial = `The task did not reach a final answer within ${MAX_STEPS} steps / ${Math.round(TOTAL_BUDGET_MS / 1000)} s. Work so far:\n${clip(workLog, 4000)}`;
    await finishJob(jobId, { status: "error", error: partial });
    return { ok: false, detail: partial };
  }

  // The ROUTING line is for the filing step only — never shown, mailed or stored as part of the answer.
  const { body, routing } = parseRoutingBlock(finalText);
  await finishJob(jobId, { status: "done", resultText: body });

  // 1. Report: memory entry, lesson, DB row, letterhead PDF by email, PDF into the job's Drive folder.
  const folderPath = topicFolderPath(routing, job.prompt, job.createdAt);
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const report = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: subjectFor(job.prompt, job.createdAt, job.jobId),
    bodyParagraphs: paragraphs,
    pdfBodyParagraphs: pdfParagraphsFor(paragraphs),
    memoryKind: "one_off_task",
    agentId: job.agentId,
    domain: "mrv",
    driveSubfolders: folderPath,
  });

  // 2. Learn and file, in parallel (they touch different things). Best-effort: a failure here
  //    is reported in the detail line but never costs the report that already went out.
  const { learnFromJob } = await import("./learnFromJob");
  const { fileJobToDrive } = await import("./fileJobToDrive");
  const [learned, filed] = await Promise.all([
    learnFromJob(ctx, { job, body, routing, toolsUsed, failures }).catch((e: unknown) => ({
      stored: 0,
      note: `memory step failed: ${e instanceof Error ? e.message : String(e)}`,
    })),
    fileJobToDrive(ctx, { job, body, routing, folderPath }).catch((e: unknown) => ({
      summary: `Drive filing failed: ${e instanceof Error ? e.message : String(e)}`,
    })),
  ]);
  return {
    ok: report.ok,
    detail: `${report.detail} Memory: ${learned.stored} item(s) stored. Drive: ${filed.summary}. (job ${jobId})`,
  };
}
```

- [ ] **Step 2: Register the handler** — in `web/src/lib/agent/scheduledTaskRegistry.ts` add the import next to the others and one entry:

```ts
import { TASK_KEY as REBEKA_ONE_OFF_TASK_KEY, runAgentJob } from "./oneOff/runAgentJob";
// …inside SCHEDULED_TASK_REGISTRY:
  [REBEKA_ONE_OFF_TASK_KEY]: (ctx) => {
    const jobId = ctx.taskParams?.jobId;
    return jobId
      ? runAgentJob(ctx, jobId)
      : Promise.resolve({ ok: false, detail: "Open the task and submit a request — nothing to run without one." });
  },
```

- [ ] **Step 3: Check that `ToolContext` carries `taskParams`**

Run: `grep -n "taskParams" web/src/lib/tools/context.ts`
Expected: `59:  taskParams?: Record<string, string>;` — already there (added for Dave's farm picker; `runScheduledTaskNow.ts:79` passes it into every handler's context). Nothing to change in `context.ts`; drop it from the `git add` below.

- [ ] **Step 4: Do not type-check yet**

The loop dynamically imports `./recall`, `./learnFromJob` and `./fileJobToDrive`, which Tasks 4b–4d create. `npx tsc --noEmit` is run at the end of Task 4d, when all of them exist.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/agent/oneOff/runAgentJob.ts web/src/lib/agent/scheduledTaskRegistry.ts
git commit -m "feat(rebeka): bounded multi-step agent job loop + registry entry"
```

### Task 4b: Recall — she starts every task knowing what she learned before

**Files:**
- Create: `web/src/lib/agent/oneOff/recall.ts`

- [ ] **Step 1: Write the recall module**

```ts
// web/src/lib/agent/oneOff/recall.ts
import "server-only";
import type { ToolContext } from "../../tools/context";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import { ONE_OFF_TASK_KEY } from "./jobInput";

export interface RecalledForJob {
  /** Appended to the agent's system prompt; empty string when nothing was recalled. */
  block: string;
  lessons: number;
  memories: number;
}

/**
 * Same recall-then-fold pattern runAgentTask uses for a chat turn (recallLessons + recallDomainLessons),
 * plus the vector memory itself: the findings, conclusions and sources earlier one-off tasks stored.
 * Never throws — a missing memory is not a reason to block real work.
 */
export async function recallForJob(ctx: ToolContext, prompt: string): Promise<RecalledForJob> {
  try {
    const situation = prompt.slice(0, 300);
    const { recallLessons, recallDomainLessons } = await import("../lessonMemory");
    const { recallAgentMemory } = await import("../../tools/recallAgentMemory");

    const [own, domain, mem] = await Promise.all([
      recallLessons(ctx, { actionName: ONE_OFF_TASK_KEY, projectId: TARGET_PROJECT_ID, situation, limit: 4 }),
      recallDomainLessons(ctx, { domain: "mrv", situation, projectId: TARGET_PROJECT_ID, limit: 3 }),
      recallAgentMemory(ctx, { query: prompt.slice(0, 500), projectId: TARGET_PROJECT_ID, limit: 6 }),
    ]);

    const lessons = [...own, ...domain].map((l) => `- ${l.content}`);
    const memories = mem.ok
      ? mem.data.memories
          .filter((m) => m.kind !== "lesson")
          .map((m) => `- [${m.kind}, ${m.createdAt.slice(0, 10)}] ${m.content.slice(0, 500)}`)
      : [];

    const block =
      (lessons.length
        ? "\n\nLessons from your past one-off tasks and related MRV work (apply them — don't repeat a known mistake):\n" +
          lessons.join("\n")
        : "") +
      (memories.length
        ? "\n\nThings you stored earlier that may be relevant (verify against the sources before relying on them; say when you use one):\n" +
          memories.join("\n")
        : "");
    return { block, lessons: lessons.length, memories: memories.length };
  } catch {
    return { block: "", lessons: 0, memories: 0 };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/agent/oneOff/recall.ts
git commit -m "feat(rebeka): recall lessons and stored memories before a one-off task"
```

### Task 4c: Learn — findings, conclusions and a lesson go to long-term memory

`finishScheduledTask` already stores the whole report as one memory and distils one lesson from it. That is not enough for a one-off: a single blob is hard to retrieve later. This step stores **atomic** items (one finding / conclusion / source / open question each, with the job id, topic, farm and links in `metadata`) and a richer lesson that includes *which tools worked and what failed*.

**Files:**
- Create: `web/src/lib/agent/oneOff/learnFromJob.ts`

- [ ] **Step 1: Write the module**

```ts
// web/src/lib/agent/oneOff/learnFromJob.ts
import "server-only";
import type { ToolContext } from "../../tools/context";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import { ONE_OFF_TASK_KEY, parseMemoryItems, type Routing } from "./jobInput";
import type { OneOffJob } from "./jobStore";

const EXTRACT_SYSTEM_PROMPT =
  "You are Rebeka's memory clerk. From the finished one-off task below, extract the durable knowledge worth " +
  "remembering months from now. Return ONLY a JSON array (at most 8 items) of " +
  '{"kind":"finding"|"conclusion"|"source"|"open_question","text":"..."}. ' +
  "Each text is one or two self-contained sentences in the language of the request, with the source URL or file " +
  "name inside the text when there is one. Skip anything that would not help a future task. " +
  "If nothing durable, return [].";

export async function learnFromJob(
  ctx: ToolContext,
  input: { job: OneOffJob; body: string; routing: Routing; toolsUsed: string[]; failures: string[] },
): Promise<{ stored: number; note?: string }> {
  const { getConfiguredProvider } = await import("../provider");
  const { recordAgentMemory } = await import("../../tools/recordAgentMemory");
  const { recordLesson } = await import("../lessonMemory");
  const { job, body, routing } = input;

  let items: Array<{ kind: string; text: string }> = [];
  try {
    const provider = await getConfiguredProvider();
    const resp = await provider.complete({
      system: EXTRACT_SYSTEM_PROMPT,
      userMessage: `REQUEST:\n${job.prompt}\n\nLINKS: ${job.links.join(", ") || "none"}\n\nFINAL ANSWER:\n${body}`,
      tools: [],
      timeoutMs: 40_000,
      maxTokens: 2048,
    });
    items = resp.kind === "text" ? parseMemoryItems(resp.text) : [];
  } catch {
    items = [];
  }

  let stored = 0;
  for (const it of items) {
    const r = await recordAgentMemory(ctx, {
      projectId: TARGET_PROJECT_ID,
      kind: `one_off_${it.kind}`,
      domain: "mrv",
      content: it.text,
      metadata: { jobId: job.jobId, topic: routing.topic, farm: routing.farm, links: job.links },
    });
    if (r.ok) stored++;
  }

  // A lesson about HOW the task went (tools that worked, what failed) — the next run's recall reads it.
  await recordLesson(ctx, {
    agentId: job.agentId,
    actionName: ONE_OFF_TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    domain: "mrv",
    outcomeSummary:
      `Request: ${job.prompt.slice(0, 600)}\n` +
      `Tools used: ${input.toolsUsed.join(", ") || "none"}\n` +
      `Problems: ${input.failures.join("; ") || "none"}\n` +
      `Answer (start): ${body.slice(0, 1200)}`,
  });

  return { stored };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/agent/oneOff/learnFromJob.ts
git commit -m "feat(rebeka): store atomic findings/conclusions and a lesson after each one-off task"
```

### Task 4d: File — the work lands in the right Drive folders

**Files:**
- Modify: `web/src/lib/reports/scheduledTaskReport.ts` (optional `driveSubfolders`)
- Create: `web/src/lib/agent/oneOff/fileJobToDrive.ts`

- [ ] **Step 1: Let `finishScheduledTask` place its PDF in a sub-path.** In the `input` type add, after `domain?`:

```ts
    /** Folder path under the agent's own Drive folder for the PDF (created if missing). Omit to keep the old behaviour: the folder root. */
    driveSubfolders?: string[];
    /** What goes on the letterhead PDF when it must differ from the email/memory text (Hebrew cannot be printed yet). Omit to use bodyParagraphs. */
    pdfBodyParagraphs?: string[];
```

and in the `buildLetterheadPdf({ … })` call change `bodyParagraphs: input.bodyParagraphs,` to `bodyParagraphs: input.pdfBodyParagraphs ?? input.bodyParagraphs,`.

and replace the upload inside the Drive `try` block:

```ts
      if (driveFolderId) {
        const { ensureSubfolder, uploadFileToDriveFolder } = await import("../google/driveClient");
        let targetFolderId = driveFolderId;
        for (const name of input.driveSubfolders ?? []) {
          targetFolderId = await ensureSubfolder(ctx.googleAccessToken, targetFolderId, name);
        }
        await uploadFileToDriveFolder(ctx.googleAccessToken, targetFolderId, fileName, "application/pdf", pdfBuffer);
      }
```

All 19 existing tasks omit `driveSubfolders`, so their behaviour is unchanged.

- [ ] **Step 2: Write the filing module**

```ts
// web/src/lib/agent/oneOff/fileJobToDrive.ts
import "server-only";
import type { ToolContext } from "../../tools/context";
import type { Routing } from "./jobInput";
import type { OneOffJob } from "./jobStore";

/**
 * Puts everything about the task next to its PDF (which finishScheduledTask already uploaded):
 *   <Rebeka's folder>/One-off tasks/<topic>/<date — title>/{report.pdf, report.md, request.md, sources.md, attachments/*.txt}
 * and, when the answer is about a named farm that has its own Drive folder, a shortcut to that folder inside the farm's folder.
 * Her rebeka_drive_digestion round re-reads this folder later, which closes the learning loop.
 */
export async function fileJobToDrive(
  ctx: ToolContext,
  input: { job: OneOffJob; body: string; routing: Routing; folderPath: string[] },
): Promise<{ summary: string }> {
  const token = ctx.googleAccessToken;
  if (!token) return { summary: "no Google access token — nothing filed" };

  const { query } = await import("../../db");
  const { ensureSubfolder, uploadFileToDriveFolder, createDriveShortcut } = await import("../../google/driveClient");
  const { job, routing } = input;

  const agentRows = await query<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM mrv.agents WHERE agent_id = $1`,
    [job.agentId],
  );
  const root = agentRows[0]?.drive_folder_id;
  if (!root) return { summary: "Rebeka has no linked Drive folder" };

  let folderId = root;
  for (const name of input.folderPath) folderId = await ensureSubfolder(token, folderId, name);

  const text = (name: string, content: string) =>
    uploadFileToDriveFolder(token, folderId, name, "text/markdown", Buffer.from(content, "utf8"));

  await text("request.md", `# Request\n\n${job.prompt}\n\nRequested by: ${job.requestedBy}\nDate: ${job.createdAt}\n`);
  await text("report.md", `# Report\n\n${input.body}\n`);
  await text(
    "sources.md",
    `# Sources\n\n${job.links.map((l) => `- ${l}`).join("\n") || "(no links)"}\n\n## Attached files\n\n` +
      (job.attachments.map((a) => `- ${a.name}${a.truncated ? " (truncated)" : ""}`).join("\n") || "(none)") +
      "\n",
  );

  if (job.attachments.length) {
    const attFolder = await ensureSubfolder(token, folderId, "attachments");
    for (const a of job.attachments) {
      await uploadFileToDriveFolder(token, attFolder, `${a.name}.txt`, "text/plain", Buffer.from(a.text, "utf8"));
    }
  }

  let farmNote = "";
  if (routing.farm) {
    const farms = await query<{ drive_folder_id: string | null }>(
      `SELECT drive_folder_id FROM mrv.farms WHERE lower(name) = lower($1)`,
      [routing.farm],
    );
    if (farms.length === 1 && farms[0].drive_folder_id) {
      await createDriveShortcut(token, folderId, input.folderPath[2], farms[0].drive_folder_id);
      farmNote = `, shortcut in ${routing.farm}'s folder`;
    }
  }
  return { summary: `${input.folderPath.join(" / ")}${farmNote}` };
}
```

- [ ] **Step 3: Type-check everything built so far**

Run (from `web/`): `npx tsc --noEmit`
Expected: exit 0. (If `recallAgentMemory`'s input or `ToolContext.taskParams` differ from what is written here, align to `RecallAgentMemoryInput` in `lib/tools/recallAgentMemory.ts:4` and `lib/tools/context.ts`.)

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/reports/scheduledTaskReport.ts web/src/lib/agent/oneOff/fileJobToDrive.ts
git commit -m "feat(rebeka): file one-off task work into Drive topic/date folders"
```

### Task 5: The long-running route and the server actions

**Files:**
- Create: `web/src/app/api/agents/one-off/run/route.ts`
- Create: `web/src/lib/agent/oneOff/oneOffActions.ts`

The route is called **server-to-server by the action**, authenticated with `EXTERNAL_AGENT_SECRET` (already set in Vercel and used by the sibling `/api/agents/rebeka/*` routes). It answers `202` at once and does the run in `after()`, so the 280 s budget belongs to the route, not to the page.

- [ ] **Step 1: Write the route**

```ts
// web/src/app/api/agents/one-off/run/route.ts
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 280;

export async function POST(req: Request) {
  const expected = process.env.EXTERNAL_AGENT_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { jobId?: string; requestedBy?: string } | null;
  if (!body?.jobId || !/^[0-9a-f-]{36}$/i.test(body.jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  const jobId = body.jobId;
  const requestedBy = body.requestedBy ?? "unknown";

  after(async () => {
    const { query } = await import("@/lib/db");
    const { runScheduledTaskNow } = await import("@/lib/agent/runScheduledTaskNow");
    const rows = await query<{ task_id: string; agent_id: string; frequency: string; next_run_at: string }>(
      `SELECT task_id, agent_id, frequency, next_run_at FROM mrv.scheduled_tasks WHERE task_key = 'rebeka_one_off_task'`,
    );
    if (!rows.length) return;
    const r = rows[0];
    await runScheduledTaskNow(
      { taskId: r.task_id, agentId: r.agent_id, taskKey: "rebeka_one_off_task", frequency: r.frequency, nextRunAt: r.next_run_at },
      `manual:${requestedBy}`,
      { jobId },
    );
  });

  return NextResponse.json({ accepted: true, jobId }, { status: 202 });
}
```

- [ ] **Step 2: Write the server actions**

```ts
// web/src/lib/agent/oneOff/oneOffActions.ts
"use server";

import { auth } from "@/auth";
import { DATA_MODE } from "@/lib/env";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import { capAttachments, normalizeLinks, ONE_OFF_TASK_KEY, type JobAttachment } from "./jobInput";
import type { OneOffJob } from "./jobStore";

export type StartOneOffResult = { ok: true; jobId: string; notes: string[] } | { ok: false; error: string };

export async function startOneOffJobAction(input: {
  prompt: string;
  links: string[];
  attachments: JobAttachment[];
}): Promise<StartOneOffResult> {
  if (DATA_MODE !== "db") return { ok: false, error: "One-off tasks need the database." };
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Sign in to run a task." };
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Write what you want Rebeka to do." };
  if (prompt.length > 8000) return { ok: false, error: "The request is longer than 8,000 characters — shorten it or attach it as a file." };

  const { links, rejected } = normalizeLinks(input.links);
  const { attachments, droppedNames } = capAttachments(input.attachments);
  const notes = [
    ...(rejected.length ? [`Ignored ${rejected.length} link(s) that are not valid http(s) URLs or exceed the limit.`] : []),
    ...(droppedNames.length ? [`Skipped ${droppedNames.join(", ")} — over the total attachment size limit.`] : []),
  ];

  const { createJob } = await import("./jobStore");
  const jobId = await createJob({ agentId: "rebeka", requestedBy: email, prompt, links, attachments });

  const secret = process.env.EXTERNAL_AGENT_SECRET;
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3007");
  if (!secret) return { ok: false, error: "EXTERNAL_AGENT_SECRET is not configured — cannot start the run." };
  const res = await fetch(`${base}/api/agents/one-off/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ jobId, requestedBy: email }),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    const why = res instanceof Error ? res.message : `HTTP ${res.status}`;
    const { finishJob } = await import("./jobStore");
    await finishJob(jobId, { status: "error", error: `Could not start the run (${why}).` });
    return { ok: false, error: `Could not start the run (${why}).` };
  }
  return { ok: true, jobId, notes };
}

export async function getOneOffJobAction(jobId: string): Promise<OneOffJob | null> {
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return null;
  const { getJob } = await import("./jobStore");
  return getJob(jobId);
}

/**
 * Nitzan's verdict on a finished task. Written as a real human verdict (mrv.agent_feedback — recordAgentFeedback is
 * human-only by design), and — when it is a correction or a rejection — immediately distilled into a lesson, so the
 * next one-off task's recall already carries it. This is the "she improves from every task" half that a model
 * cannot do on its own.
 */
export async function rateOneOffJobAction(input: {
  jobId: string;
  verdict: "approved" | "corrected" | "rejected";
  correctionText?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Sign in to rate a task." };

  const { getJob } = await import("./jobStore");
  const job = await getJob(input.jobId);
  if (!job || job.status !== "done") return { ok: false, error: "Only a finished task can be rated." };

  const correction = input.correctionText?.trim() ?? "";
  if (input.verdict !== "approved" && !correction) {
    return { ok: false, error: "Say what was wrong, or what Rebeka should do differently." };
  }

  const { recordAgentFeedback } = await import("@/lib/tools/recordAgentFeedback");
  const saved = await recordAgentFeedback(
    { actor: email, actorKind: "human" },
    {
      agentId: job.agentId,
      actionName: ONE_OFF_TASK_KEY,
      targetType: "adhoc_agent_job",
      targetId: job.jobId,
      verdict: input.verdict,
      correctionText: correction || null,
    },
  );
  if (!saved.ok) return { ok: false, error: saved.error };

  if (input.verdict !== "approved") {
    const { recordLesson } = await import("@/lib/agent/lessonMemory");
    await recordLesson(
      { actor: job.agentId, actorKind: "agent" },
      {
        agentId: job.agentId,
        actionName: ONE_OFF_TASK_KEY,
        projectId: TARGET_PROJECT_ID,
        domain: "mrv",
        outcomeSummary:
          `Request: ${job.prompt.slice(0, 600)}\n` +
          `My answer (start): ${(job.resultText ?? "").slice(0, 1000)}\n` +
          `Nitzan's verdict: ${input.verdict} — ${correction}`,
      },
    );
  }
  return { ok: true };
}
```

- [ ] **Step 3: Confirm the app-URL env var name used elsewhere**

Run: `grep -rn "NEXTAUTH_URL\|NEXT_PUBLIC_APP_URL\|AUTH_URL" web/src web/.env.example | head`
Expected: shows which base-URL variable this app really uses; replace the fallback chain in the action with that exact one.

- [ ] **Step 4: Type-check, then commit**

```bash
npx tsc --noEmit
git add web/src/app/api/agents/one-off/run/route.ts web/src/lib/agent/oneOff/oneOffActions.ts
git commit -m "feat(rebeka): long-running one-off route (280s, after()) and start/status actions"
```

### Task 6: The popup form (prompt, files, links, progress, result)

**Files:**
- Create: `web/src/components/agents/OneOffTaskForm.tsx`
- Modify: `web/src/components/agents/ScheduledTasksPanel.tsx` (inside `TaskPopup`, next to the `wizardStep` branches)

- [ ] **Step 1: Write the form component**

```tsx
// web/src/components/agents/OneOffTaskForm.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { extractAttachmentText } from "@/lib/agent/extractAttachmentText";
import { getOneOffJobAction, rateOneOffJobAction, startOneOffJobAction } from "@/lib/agent/oneOff/oneOffActions";
import type { OneOffJob } from "@/lib/agent/oneOff/jobStore";

interface Attached {
  name: string;
  text: string;
  truncated: boolean;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** "Was this useful?" — the human verdict that makes the next task better (see rateOneOffJobAction). */
function FeedbackBox({ jobId }: { jobId: string }) {
  const [verdict, setVerdict] = useState<"approved" | "corrected" | "rejected" | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(v: "approved" | "corrected" | "rejected") {
    setSaving(true);
    setError(null);
    const res = await rateOneOffJobAction({ jobId, verdict: v, correctionText: text });
    setSaving(false);
    if (res.ok) setSaved(true);
    else setError(res.error);
  }

  if (saved) return <p className="mt-3 text-[12px] text-ok">Thanks — Rebeka will use this on her next task.</p>;
  return (
    <div className="mt-3 rounded-lg border border-line p-2.5">
      <p className="text-[11.5px] font-semibold text-muted">Was this useful? Rebeka learns from your answer.</p>
      <div className="mt-1.5 flex gap-2">
        <button type="button" disabled={saving} onClick={() => save("approved")} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[12px] font-semibold text-ok hover:bg-cream disabled:opacity-60">
          Useful
        </button>
        <button type="button" onClick={() => setVerdict("corrected")} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[12px] font-semibold text-earth-600 hover:bg-cream">
          Needs correction
        </button>
        <button type="button" onClick={() => setVerdict("rejected")} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[12px] font-semibold text-danger hover:bg-cream">
          Wrong
        </button>
      </div>
      {verdict && (
        <>
          <textarea
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What was wrong, or what should she do differently next time?"
            className="mt-2 w-full rounded-lg border border-line p-2 text-[12.5px] outline-none focus:border-pine-400"
          />
          <button type="button" disabled={saving || !text.trim()} onClick={() => save(verdict)} className="mt-2 w-full rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-pine-700 disabled:opacity-60">
            {saving ? "Saving…" : "Send to Rebeka"}
          </button>
        </>
      )}
      {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

export function OneOffTaskForm({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [files, setFiles] = useState<Attached[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [job, setJob] = useState<OneOffJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Poll every 4 s until the job leaves queued/running.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    async function tick() {
      const j = await getOneOffJobAction(jobId!).catch(() => null);
      if (stop) return;
      if (j) setJob(j);
      if (!j || j.status === "queued" || j.status === "running") setTimeout(tick, 4000);
    }
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    setFileError(null);
    setReading(true);
    try {
      for (const f of picked) {
        const res = await extractAttachmentText({ name: f.name, base64: await fileToBase64(f) });
        if (res.ok) setFiles((cur) => [...cur, { name: f.name, text: res.data.text, truncated: res.data.truncated }]);
        else setFileError(res.error);
      }
    } finally {
      setReading(false);
    }
  }

  function addLink() {
    const v = linkInput.trim();
    if (!v) return;
    setLinks((cur) => (cur.includes(v) ? cur : [...cur, v]));
    setLinkInput("");
  }

  async function submit() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await startOneOffJobAction({ prompt, links, attachments: files });
      if (res.ok) {
        setNotes(res.notes);
        setJobId(res.jobId);
      } else {
        setStartError(res.error);
      }
    } finally {
      setStarting(false);
    }
  }

  const running = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");
  const finished = job && !running;

  return (
    <div className="p-4">
      {!jobId && (
        <>
          <p className="mb-1.5 text-[12.5px] text-muted">What should Rebeka do? (Hebrew or English)</p>
          <textarea
            dir="auto"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            autoFocus
            className="w-full rounded-lg border border-line p-2.5 text-[13px] text-ink outline-none focus:border-pine-400"
          />

          <div className="mt-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.csv,.tsv,.json,.md,.log,.yaml,.yml,.docx,.xlsx,.pdf"
              className="hidden"
              onChange={onFiles}
            />
            <button
              type="button"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted hover:border-pine-300 hover:text-pine-700 disabled:opacity-50"
            >
              {reading ? "Reading…" : "Attach files"}
            </button>
            {files.map((f) => (
              <span key={f.name} className="ml-2 inline-flex items-center gap-1 rounded-full bg-pine-50 px-2.5 py-1 text-[11px] text-pine-700">
                <span className="max-w-[140px] truncate">{f.name}</span>
                {f.truncated && <span>(truncated)</span>}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((c) => c.filter((x) => x !== f))}>
                  ×
                </button>
              </span>
            ))}
            {fileError && <p className="mt-1 text-[11px] text-danger">{fileError}</p>}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="url"
              dir="ltr"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())}
              placeholder="https://… (press Enter to add)"
              className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[12.5px] outline-none focus:border-pine-400"
            />
            <button type="button" onClick={addLink} className="rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-muted hover:bg-cream">
              Add
            </button>
          </div>
          {links.map((l) => (
            <p key={l} dir="ltr" className="mt-1 flex items-center justify-between truncate rounded bg-cream px-2 py-1 font-mono text-[11px] text-ink">
              <span className="truncate">{l}</span>
              <button type="button" aria-label={`Remove ${l}`} onClick={() => setLinks((c) => c.filter((x) => x !== l))}>
                ×
              </button>
            </p>
          ))}

          {startError && <p className="mt-2 text-[12px] text-danger">{startError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-muted hover:bg-cream">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!prompt.trim() || starting || reading}
              className="flex-[2] rounded-lg bg-pine-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-pine-700 disabled:opacity-60"
            >
              {starting ? "Starting…" : "Run Rebeka"}
            </button>
          </div>
        </>
      )}

      {jobId && (
        <div>
          {notes.map((n) => (
            <p key={n} className="mb-1 text-[11.5px] text-earth-600">{n}</p>
          ))}
          <p className="text-[12.5px] font-semibold text-pine-700">
            {running ? "Rebeka is working… you can close this window; the report will arrive by email." : job?.status === "done" ? "Done" : job?.status === "needs_approval" ? "Waiting for approval" : "Failed"}
          </p>
          <ol className="mt-2 space-y-1">
            {(job?.progress ?? []).map((p) => (
              <li key={p.step} className="text-[11.5px] text-muted">
                {p.step}. {p.tool ? <span className="font-mono">{p.tool}</span> : "answer"} — {p.summary}
              </li>
            ))}
          </ol>
          {finished && (
            <div dir="auto" className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-cream p-3 text-[12.5px] leading-relaxed text-ink">
              {job.resultText ?? job.error}
            </div>
          )}
          {finished && job.status === "done" && <FeedbackBox jobId={job.jobId} />}
          {finished && (
            <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg bg-pine-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-pine-700">
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Hook it into the popup.** In `ScheduledTasksPanel.tsx`, import the form at the top and add one branch to the `wizardStep` ternary in `TaskPopup` so that, for this task only, the form replaces the Run-Now body:

```tsx
import { OneOffTaskForm } from "./OneOffTaskForm";
// …inside TaskPopup's JSX, before the existing `wizardStep === "pickFarm"` branch:
        {task.taskKey === "rebeka_one_off_task" ? (
          <OneOffTaskForm onClose={onClose} />
        ) : wizardStep === "pickFarm" && farmPickerOptions ? (
```
(Keep every existing branch unchanged after it.)

- [ ] **Step 3: Type-check and lint**

Run (from `web/`): `npx tsc --noEmit && npx eslint src/components/agents src/lib/agent/oneOff`
Expected: exit 0, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/agents/OneOffTaskForm.tsx web/src/components/agents/ScheduledTasksPanel.tsx
git commit -m "feat(rebeka): one-off task popup — prompt, files, links, progress, result"
```

### Task 7: Verify it for real (browser + live run)

- [ ] **Step 1: Build.** Run (from `web/`): `npm run build` — Expected: success; the new route appears as `ƒ /api/agents/one-off/run`.
- [ ] **Step 2: Start the app on port 3007** (the launcher "CarboNature MRV", never a second server on another port — Google sign-in only works on 3007).
- [ ] **Step 3: Check the panel.** Open `/agents/rebeka` — the Scheduled Tasks block shows "One Off Task" (7 active); click it; the form opens (textarea, Attach files, link box).
- [ ] **Step 4: Smoke test — Hebrew prompt, no tools.** Prompt: `תכתוב לי שלוש שורות: מה זה VM0042?` Expected: status goes `running` → `done`; the answer appears in Hebrew in the popup (without the `ROUTING:` line); step 0 says how many lessons/notes were recalled; `mrv.scheduled_task_reports` gets a row with `task_key = 'rebeka_one_off_task'`; the email arrives with the full Hebrew text in its body and a letterhead PDF holding the one-line English pointer (not a page of `?`).
- [ ] **Step 4b: English prompt, same check** — the PDF carries the whole report.
- [ ] **Step 5: Test with a file and a link.** Attach a small PDF, add `https://verra.org/…` link; Expected: progress shows a `fetch_public_url` step; the answer cites the link.
- [ ] **Step 6: Test the approval stop.** Prompt: `Generate a PDD draft for CARBO-3988` (`generate_pdd_draft` is confirm-gated). Expected: status "Waiting for approval", the action appears in `/agents/approvals`, no draft was generated. Do **not** approve it.
- [ ] **Step 7: Test double-trigger safety.** Call the route twice with the same `jobId`; Expected: the second does nothing (`markRunning` returns false).
- [ ] **Step 8: Long-term memory check.** For the Step 5 job id (shown in the run's detail line): `select kind, left(content, 90) from mrv.agent_memory where metadata->>'jobId' = '<jobId>' order by created_at;` Expected: 2–8 rows of kind `one_off_finding` / `one_off_conclusion` / `one_off_source` / `one_off_open_question`, each with its source URL or file name inside the text. Also `select count(*) from mrv.agent_memory where kind = 'one_off_task'` grew by one (the whole report).
- [ ] **Step 9: Drive check.** In Drive, Rebeka's folder (`AI-Agent library / Rebeka`) now holds `One-off tasks / <topic> / <date — title> /` with `report.pdf`, `report.md`, `request.md`, `sources.md` and, for the Step 5 run, `attachments/<file>.txt`. If the answer named a farm, a shortcut to that folder exists inside the farm's Drive folder.
- [ ] **Step 10: Learning check — the part that proves she improves.** (a) In the popup press **Needs correction** on the Step 4b result and write a concrete instruction (e.g. "always cite the Verra document number"). (b) Check `select verdict, correction_text from mrv.agent_feedback where target_id = '<jobId>'` has the row, and a new `kind = 'lesson'` memory with `metadata->>'actionName' = 'rebeka_one_off_task'` exists. (c) Start a *similar* task; Expected: step 0 now says it recalled ≥ 1 lesson, and the answer follows the instruction. If it does not, the recall block (Task 4b) is not reaching the prompt — fix before shipping.
- [ ] **Step 11: Time budget check.** From the Vercel logs, a typical run finishes well under 240 s including report + memory + Drive. If runs approach the cap, lower `TOTAL_BUDGET_MS` in `runAgentJob.ts` (140 s today).
- [ ] **Step 12: Report back** with the results of Steps 4–10 before pushing.

### Task 8: Ship

- [ ] **Step 1:** `git pull --rebase origin main` (parallel sessions push here), `npx tsc --noEmit`, `npm run check:sql`.
- [ ] **Step 2:** `git push origin main` — Vercel auto-deploys the MRV project; confirm the `Vercel` commit status is `success` (`gh api repos/nitzan-bauer/database-and-mrv-ai-module/commits/main/status`).
- [ ] **Step 3:** Run Step 4 of Task 7 once on the deployed app.
- [ ] **Step 4:** Add a memory note (`project_mrv_rebeka_one_off_task.md`) and a line in `docs/` describing the feature.

---

## Phase 2 — Hardening (after the first real use)

- **Rate/abuse guard:** one running job per person (`WHERE status IN ('queued','running')` check in `startOneOffJobAction`), 20 jobs/day cap.
- **Stuck-job reaper:** a job `running` for >6 min becomes `error: timed out` (checked on read in `getOneOffJobAction`, no cron needed).
- **History:** a small "Recent one-off tasks" list in the popup (last 10 jobs from `adhoc_agent_jobs`).
- **Images:** accept `.png/.jpg` in the form and pass them through `provider.complete({ images })` (the provider already supports it).
- **Drive links:** if a link is a Google Drive/Docs URL, read it with the Drive client using the signed-in user's token instead of `fetch_public_url`.

## Phase 3 — Only if a real task needs more than ~2.5 minutes of work (optional)

GitHub Actions runner, same pattern as `webinar-recording-scan.yml`: a `workflow_dispatch` workflow `rebeka-one-off.yml` (timeout 30 min) running a `scripts/one-off-run.mjs` that calls the same `runAgentJob` through an authenticated route. Needs one new secret (a fine-grained GitHub token with *Actions: write* on this repo only) — which is why it is not in Phase 1.

## Phase 4 — Hebrew letterhead PDF (decision D2b)

Embed a Hebrew-capable font (Heebo, via `@pdf-lib/fontkit`) in `lib/reports/letterheadPdf.ts`, detect Hebrew text per paragraph and lay it out right-to-left (reverse visual order, right-aligned). Includes a visual check of the generated PDF. Isolated task — it also fixes Hebrew in every other Rebeka report.

## Phase 5 — Chrome bridge: Rebeka reads the sites you keep open (decision D4b)

**What it is.** A small worker on Nitzan's PC drives a dedicated *"Rebeka Chrome"* profile. The job running on Vercel asks it — through the database — to open a page and hand back the text. **Read-only** (open + read; no clicking, typing or submitting), **only the domains ticked for that task**, and **only while the PC is on**. Page text from signed-in sites is treated as data, never as instructions; confirm-gated actions stay confirm-gated; the text is deleted from the DB when the job ends.

**Why not "just use my Chrome".** The deployed app cannot reach your browser, and since Chrome 136 remote debugging is refused on the default profile — so a separate profile that you sign in to once is the reliable route. If the spike (5.0) shows the Claude-in-Chrome extension can be driven without a person at the keyboard, that replaces 5.3 and keeps 5.1–5.2, 5.4–5.5 unchanged.

### Task 5.0: One-hour spike — pick the mechanism (no repo changes)

- [ ] **Step 1: Prove the default profile is closed.** In PowerShell:
  `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222` (with Chrome fully closed first), then `curl.exe -s http://127.0.0.1:9222/json/version`. Expected: no response / connection refused (Chrome ≥ 136 ignores the flag for the default profile).
- [ ] **Step 2: Start the dedicated profile.**
  `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.rebeka-chrome"` then sign in by hand to **one** site Rebeka will need, close nothing, and run `curl.exe -s http://127.0.0.1:9222/json/version`. Expected: JSON containing `webSocketDebuggerUrl`.
- [ ] **Step 3: Read a signed-in page over CDP.** In a scratch folder: `npm init -y && npm i playwright-core`, then `node read.mjs https://<the signed-in site>/<a members-only page>` with:

```js
// read.mjs
import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto(process.argv[2], { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
const text = await page.evaluate(() => document.body.innerText);
console.log((await page.title()), "|", text.length, "chars");
console.log(text.slice(0, 300));
await page.close();
await browser.close();
```
  Expected: the title and text of the **members-only** page (not a login screen). That is the whole capability in 15 lines.
- [ ] **Step 4: Check the alternative.** `claude --help` — look for how the Chrome extension is driven and whether a headless `claude -p` run can use it with nobody at the keyboard. If yes and stable, note it as option (b2); if not (expected), continue with Steps 5.1–5.5 as written.
- [ ] **Step 5: Record the decision** at the top of this section (which mechanism, and the one site used for the test) and delete the scratch folder.

### Task 5.1: Domain allow-list helper (pure) — with tests

**Files:**
- Create: `web/src/lib/agent/oneOff/chromeAllow.ts`
- Test: `web/tests/chromeAllow.test.mts`

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/chromeAllow.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomains, hostAllowed } from "../src/lib/agent/oneOff/chromeAllow.ts";

test("normalizeDomains reduces urls to bare hostnames, dedupes and drops junk", () => {
  assert.deepEqual(normalizeDomains(["https://www.Verra.org/x", "registry.verra.org", "bad domain", "verra.org", ""]), [
    "verra.org",
    "registry.verra.org",
  ]);
});

test("hostAllowed matches the domain and its subdomains, never look-alikes", () => {
  assert.equal(hostAllowed("verra.org", ["verra.org"]), true);
  assert.equal(hostAllowed("registry.verra.org", ["verra.org"]), true);
  assert.equal(hostAllowed("www.verra.org", ["verra.org"]), true);
  assert.equal(hostAllowed("evilverra.org", ["verra.org"]), false);
  assert.equal(hostAllowed("verra.org.evil.com", ["verra.org"]), false);
  assert.equal(hostAllowed("verra.org", []), false);
});
```

- [ ] **Step 2: Run it and watch it fail** — `node --test tests/chromeAllow.test.mts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// web/src/lib/agent/oneOff/chromeAllow.ts
// Pure module (no server-only, no aliases) — shared by the form, the tool and the PC worker's own re-check.

export const MAX_CHROME_DOMAINS = 10;

export function normalizeDomains(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    let s = r.trim().toLowerCase();
    if (!s) continue;
    try {
      s = new URL(s.includes("://") ? s : `https://${s}`).hostname;
    } catch {
      continue;
    }
    s = s.replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_CHROME_DOMAINS) break;
  }
  return out;
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}
```

- [ ] **Step 4: Run — expected `# pass 2`, `# fail 0`.** 
- [ ] **Step 5: Commit** — `git add web/src/lib/agent/oneOff/chromeAllow.ts web/tests/chromeAllow.test.mts && git commit -m "feat(rebeka): domain allow-list helper for the Chrome bridge"`

### Task 5.2: Migration 0129 — request queue, heartbeat, the tool and its policy

**Files:**
- Create: `migrations/0129_rebeka_chrome_bridge.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrate:up
ALTER TABLE mrv.adhoc_agent_jobs ADD COLUMN IF NOT EXISTS chrome_domains text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN mrv.adhoc_agent_jobs.chrome_domains IS
  'Sites Nitzan allowed Rebeka to read through his Rebeka-Chrome profile for this one task (empty = none).';

CREATE TABLE IF NOT EXISTS mrv.browser_requests (
  request_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES mrv.adhoc_agent_jobs(job_id) ON DELETE CASCADE,
  url          text NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'error', 'refused')),
  result_title text,
  result_text  text,            -- page text from a signed-in session: wiped when the job finishes (jobStore.finishJob)
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_browser_requests_queue ON mrv.browser_requests (status, created_at);

CREATE TABLE IF NOT EXISTS mrv.browser_worker_heartbeat (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_seen timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('browse_chrome_session', 'auto',
   'Read-only: opens one page in the Rebeka-Chrome profile on Nitzan''s PC and returns its text; limited to the domains ticked for that task; no clicks, typing or submits.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['browse_chrome_session']::text[]
 WHERE agent_id = 'rebeka' AND NOT ('browse_chrome_session' = ANY(tools));

-- migrate:down
UPDATE mrv.agents SET tools = array_remove(tools, 'browse_chrome_session') WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'browse_chrome_session';
DROP TABLE IF EXISTS mrv.browser_worker_heartbeat;
DROP TABLE IF EXISTS mrv.browser_requests;
ALTER TABLE mrv.adhoc_agent_jobs DROP COLUMN IF EXISTS chrome_domains;
```

- [ ] **Step 2: Dry-run, schema gate, apply** — `node scripts/db-migrate.mjs`, `npm run check:sql`, then `node scripts/db-migrate.mjs --apply`. Expected: `applied 0129_rebeka_chrome_bridge.sql`.
- [ ] **Step 3: Wipe page text when a job ends.** In `jobStore.ts` `finishJob`, after the UPDATE add: `await query(\`UPDATE mrv.browser_requests SET result_text = NULL WHERE job_id = $1\`, [jobId]);`
- [ ] **Step 4: Commit** — `git add migrations/0129_rebeka_chrome_bridge.sql web/src/lib/agent/oneOff/jobStore.ts && git commit -m "feat(rebeka): migration 0129 — Chrome bridge queue, heartbeat and tool policy"`

### Task 5.3: The tool Rebeka calls

**Files:**
- Create: `web/src/lib/tools/browseChromeSession.ts`
- Modify: `web/src/lib/agent/toolRegistry.ts` (next to the `browse_website` entry, ~line 807)
- Modify: `web/src/lib/agent/oneOff/oneOffActions.ts`, `jobStore.ts` (carry `chromeDomains` from the form into the job)

- [ ] **Step 1: Write the tool**

```ts
// web/src/lib/tools/browseChromeSession.ts
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
  const jobs = await query<{ chrome_domains: string[] }>(
    `SELECT chrome_domains FROM mrv.adhoc_agent_jobs WHERE job_id = $1`,
    [jobId],
  );
  const allowed = jobs[0]?.chrome_domains ?? [];
  if (!allowed.length) return fail("No Chrome sites were allowed for this task — use fetch_public_url for public pages.");
  if (!hostAllowed(u.hostname, allowed)) {
    return fail(`${u.hostname} is not one of the sites Nitzan allowed for this task (${allowed.join(", ")}).`);
  }

  const hb = await query<{ fresh: boolean }>(
    `SELECT (now() - last_seen) < interval '40 seconds' AS fresh FROM mrv.browser_worker_heartbeat`,
  );
  if (!hb[0]?.fresh) {
    return fail("The Chrome bridge is offline (Nitzan's PC or the Rebeka-Chrome profile is not running). Use public pages instead.");
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
    if (r?.status === "error" || r?.status === "refused") return fail(r.error ?? `The Chrome bridge ${r.status} this request.`);
  }
  return fail("Timed out waiting for the Chrome bridge (45 s).");
}
```

- [ ] **Step 2: Register it** — in `toolRegistry.ts`, add after the `browse_website` entry (import `browseChromeSession` at the top with the other tool imports):

```ts
  browse_chrome_session: {
    schema: {
      name: "browse_chrome_session",
      description:
        "Read one page through Nitzan's own signed-in Chrome profile (Rebeka-Chrome) — for sites that need his login. " +
        "Read-only, and only the sites he allowed for this task; fails fast if none were allowed or his PC is offline. " +
        "Prefer fetch_public_url for public pages.",
      inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
    handler: (ctx, input) => browseChromeSession(ctx, { url: String(input.url ?? "") }),
  },
```

- [ ] **Step 3: Carry the domains through.** `startOneOffJobAction` takes `chromeDomains: string[]`, runs `normalizeDomains`, and `createJob` inserts them into `chrome_domains` (`$6::text[]`); `getJob`'s `rowToJob` returns them; `buildTaskPrompt` adds, when non-empty, `SIGNED-IN SITES YOU MAY READ with browse_chrome_session: <domains>`.
- [ ] **Step 4: Type-check and commit** — `npx tsc --noEmit`, then `git add web/src/lib/tools/browseChromeSession.ts web/src/lib/agent/toolRegistry.ts web/src/lib/agent/oneOff && git commit -m "feat(rebeka): browse_chrome_session tool"`

### Task 5.4: The worker on the PC (auto-starts at logon)

**Files:**
- Create: `web/scripts/rebeka-chrome-worker.mjs`
- Create: `web/scripts/start-rebeka-chrome.cmd`

- [ ] **Step 1: Write the worker.** It polls every 3 s, refreshes the heartbeat every 10 s, and for each queued request: re-checks the host against the job's `chrome_domains` (defence in depth — the Vercel side checked already), refuses anything that is not http(s), opens the URL in a new tab of the Rebeka-Chrome profile, waits for the page, returns `document.body.innerText` (password inputs removed first), and closes the tab. It never clicks, types or submits, and never sends cookies anywhere — only page text goes back.

```js
// web/scripts/rebeka-chrome-worker.mjs
import fs from "fs";
import pg from "pg";
import { chromium } from "playwright-core";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.replace(/^["']|["']$/g, "");
if (!DATABASE_URL) throw new Error("DATABASE_URL missing in web/.env.local");

const db = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const hostAllowed = (host, allowed) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
};

let browser = null;
async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  return browser;
}

async function beat() {
  await db.query(
    `INSERT INTO mrv.browser_worker_heartbeat (id, last_seen) VALUES (true, now())
     ON CONFLICT (id) DO UPDATE SET last_seen = now()`,
  );
}

async function handleOne() {
  // One worker per PC, so a plain read is enough — no claim step needed.
  const { rows } = await db.query(
    `SELECT request_id, job_id, url FROM mrv.browser_requests WHERE status = 'queued' ORDER BY created_at LIMIT 1`,
  );
  if (!rows.length) return false;
  const { request_id, job_id, url } = rows[0];
  const finish = (status, f) =>
    db.query(
      `UPDATE mrv.browser_requests SET status = $2, result_title = $3, result_text = $4, error = $5, answered_at = now() WHERE request_id = $1`,
      [request_id, status, f.title ?? null, f.text ?? null, f.error ?? null],
    );

  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      await finish("refused", { error: "only http(s)" });
      return true;
    }
    const job = await db.query(`SELECT chrome_domains FROM mrv.adhoc_agent_jobs WHERE job_id = $1`, [job_id]);
    if (!hostAllowed(u.hostname, job.rows[0]?.chrome_domains ?? [])) {
      await finish("refused", { error: `${u.hostname} is not an allowed site for this task` });
      return true;
    }
    const ctx = (await getBrowser()).contexts()[0];
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const finalHost = new URL(page.url()).hostname;
      if (!hostAllowed(finalHost, job.rows[0]?.chrome_domains ?? [])) {
        await finish("refused", { error: `redirected to ${finalHost}, which is not allowed` });
        return true;
      }
      const text = await page.evaluate(() => {
        document.querySelectorAll("input[type=password]").forEach((e) => e.remove());
        return document.body.innerText;
      });
      await finish("done", { title: await page.title(), text });
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    await finish("error", { error: e instanceof Error ? e.message : String(e) });
  }
  await db.query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload) VALUES ('rebeka-chrome-worker', 'browse_chrome_session', 'adhoc_agent_job', $1, $2::jsonb)`,
    [String(job_id), JSON.stringify({ url })],
  );
  return true;
}

let lastBeat = 0;
for (;;) {
  try {
    if (Date.now() - lastBeat > 10_000) {
      await beat();
      lastBeat = Date.now();
    }
    if (!(await handleOne())) await new Promise((r) => setTimeout(r, 3000));
  } catch (e) {
    console.error("worker loop:", e instanceof Error ? e.message : e);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
```

- [ ] **Step 2: Add the dependency** — from `web/`: `npm i playwright-core` (no browser download; it only attaches to your Chrome). Commit the lockfile change.
- [ ] **Step 3: The launcher.**

```bat
@echo off
rem web/scripts/start-rebeka-chrome.cmd — Rebeka's own Chrome profile + the bridge worker
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.rebeka-chrome" --no-first-run
timeout /t 8 /nobreak >nul
cd /d "%~dp0.."
node scripts\rebeka-chrome-worker.mjs
```

- [ ] **Step 4: Start it at every logon (full automation, no thing to remember).** In PowerShell:
  `schtasks /Create /SC ONLOGON /TN "Rebeka Chrome Worker" /TR "\"C:\Users\nitza\OneDrive\Desktop\claude code\database-and-mrv-ai-module\web\scripts\start-rebeka-chrome.cmd\"" /RL LIMITED /F`
  Expected: `SUCCESS: The scheduled task "Rebeka Chrome Worker" has been successfully created.` Kill switch: `schtasks /Delete /TN "Rebeka Chrome Worker" /F` and close its window.
- [ ] **Step 5: Sign in once** to each site she should reach, inside the *Rebeka Chrome* window that opens (not your everyday Chrome). The profile keeps the cookies.
- [ ] **Step 6: Commit** — `git add web/scripts/rebeka-chrome-worker.mjs web/scripts/start-rebeka-chrome.cmd web/package.json web/package-lock.json && git commit -m "feat(rebeka): Chrome bridge worker for the PC"`

### Task 5.5: Form control and the end-to-end check

- [ ] **Step 1: In `OneOffTaskForm.tsx`** add, under the links box, a section "Sites Rebeka may read in my Chrome (signed-in)" with a text input + Add button (same pattern as links, `normalizeDomains` on submit) and a one-line note: *"Read-only. Works while your PC and Rebeka Chrome are running."* Pass the list as `chromeDomains` to `startOneOffJobAction`.
- [ ] **Step 2: Offline behaviour.** With the worker stopped, run a task that lists a signed-in site. Expected: the `browse_chrome_session` step shows "bridge is offline…", and Rebeka continues with public pages and says what she could not read — the task is not lost.
- [ ] **Step 3: Online behaviour.** Start the worker, sign in to the test site in Rebeka Chrome, run a task: *"Summarise what the members-only page <URL> says"* with that domain ticked. Expected: a `browse_chrome_session` step succeeds and the answer reflects the members-only content.
- [ ] **Step 4: Refusals.** (a) A URL on a domain that was *not* ticked → refused on the Vercel side. (b) A link that redirects off-domain → the worker refuses it. (c) Check `mrv.browser_requests.result_text` is `NULL` for the finished job.
- [ ] **Step 5: Ship** — `git pull --rebase origin main`, `npx tsc --noEmit`, `npm run check:sql`, push; confirm the Vercel status; then add the worker/launcher notes to the memory file for this feature.

---

## Self-review

- **Spec coverage.**
  - Row in the Scheduled Tasks block, opens a window → Tasks 2, 6.
  - Prompt in Hebrew or English → `dir="auto"` textarea; language-matching instruction (Task 1).
  - Upload files → Task 6, reusing `extractAttachmentText`. Insert links → Tasks 1, 6, and `fetch_public_url`/`browse_website` in the loop (Task 4).
  - Rebeka really runs, multi-step, with her own tools → Task 4. Result on screen, by email → Tasks 4, 6, 7.
  - **Findings, conclusions, summaries and documents in long-term memory** → Task 4c (atomic memories + lesson) and `finishScheduledTask` (whole report).
  - **She learns and improves from every task** → recall before the run (4b), lesson after it (4c), Nitzan's verdict turned into a lesson at once (Task 5 `rateOneOffJobAction`, Task 6 `FeedbackBox`), verified by the Task 7 Step 10 two-run test.
  - **Everything saved in Drive in the right folders** → Task 4d (topic/date folder, request/sources/attachments, farm shortcut) and D5.
  - **Access to the sites open in Chrome** → Phase 5, with the honest limits stated (separate profile, PC on, read-only, per-task domains).
- **Placeholders:** none. Conditional steps are explicit greps or type-checks with expected output. Task 5.0 is a spike by design and says exactly what to run and what decides the outcome.
- **Type consistency:** `JobAttachment`, `Routing`, `ProgressEntry`, `OneOffJob`, `ONE_OFF_TASK_KEY`, `runAgentJob(ctx, jobId)`, `recallForJob`, `learnFromJob`, `fileJobToDrive`, `topicFolderPath`, `pdfParagraphsFor`, `subjectFor`, `normalizeDomains`, `hostAllowed` are named identically wherever they appear.
- **Verified while writing:** the Task 1 module and its 9 tests were extracted from this document and run with `node --test` — 9/9 pass. Everything else is checked by `tsc`, the schema gate and the live checks in Task 7 / 5.5.
- **Known risks:** Hebrew PDF (D2 — handled by a pointer paragraph, fixed properly in Phase 4); 60 s page limit (own 280 s route); single-step runtime (own loop, 140 s research budget inside the 240 s handler cap); confirm-gated tools (stop, never bypass); one shared live DB (migrations 0128/0129 are additive); a signed-in Chrome profile is a real credential store (read-only, per-task domains, text wiped after the job, kill switch = delete the scheduled task); pages read from signed-in sites can contain text that tries to steer her (treated as data, confirm-gated actions cannot be triggered by it).
