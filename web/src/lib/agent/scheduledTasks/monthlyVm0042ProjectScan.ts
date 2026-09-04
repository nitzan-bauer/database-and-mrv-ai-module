import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_monthly_vm0042_project_scan";

const SYSTEM_PROMPT =
  "You are John, CarboNature's Head of the AI-agent department. Use real web search to find real projects " +
  "that have issued carbon credits in roughly the last 3 years under two categories: (1) Verra's VM0042 " +
  "methodology (Improved Agricultural Land Management), any registry status, and (2) non-Verra " +
  "regenerative-agriculture projects that have issued credits under any other registry (e.g. Gold Standard, " +
  "Puro.earth, a national registry). For each project you actually find, with a real source, report: " +
  "registry (the real registry name), methodology (the real methodology code, or null if not VM0042), " +
  "issuer_name (the company/entity the source names as having issued or developed the credits — e.g. " +
  '"Boomitra", "Agreena", the project proponent — never the abstract project title itself), project_name, ' +
  "location (if the source states one), credits_issued_note (whatever the source itself says about issued " +
  "quantity/date, verbatim — never compute, estimate, or round a figure yourself), and source_url (the real " +
  "page you found this on). Return ONLY a JSON object, no prose, no markdown fences: " +
  '{"projects":[{"registry":string,"methodology":string|null,"issuer_name":string,"project_name":string,' +
  '"location":string|null,"credits_issued_note":string,"source_url":string}]}. Only include a project you ' +
  "found a real, checkable source for — never invent a project, an issuer, a figure, or a URL. If you can't " +
  "tell who the real issuer is, use the registry name as issuer_name rather than guessing a company. If you " +
  "find nothing solid, return an empty array.";

interface ScannedProject {
  registry: string;
  methodology: string | null;
  issuer_name: string;
  project_name: string;
  location: string | null;
  credits_issued_note: string;
  source_url: string;
}

function parseProjects(text: string): ScannedProject[] {
  try {
    // .trim() BEFORE stripping fences — see monthlyCreditMarketScan.ts's
    // parseDeals for why the anchored strip regexes need pre-trimmed input.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { projects?: ScannedProject[] };
    return parsed.projects ?? [];
  } catch {
    return [];
  }
}

/**
 * John's monthly VM0042 + non-Verra regenerative-ag project scan
 * (Nitzan's own spec, attached prompt): find who else has actually issued
 * credits — a real web-search sweep, not a guess dressed as one. Each
 * find is a row in mrv.market_scan_projects (0080) the department
 * dashboard reads; upsert is on (registry, project_name) so a project
 * already known just gets skipped, not duplicated.
 */
export async function runMonthlyVm0042ProjectScan(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
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
      `Today's date: ${new Date().toISOString().slice(0, 10)}. Search for VM0042 (any registry) and ` +
      `non-Verra regenerative-agriculture projects that have issued carbon credits in roughly the last 3 years.` +
      lessonsBlock,
    tools: [],
    webSearch: { maxUses: 2, timeoutMs: 30_000 },
  });
  console.log(`[${TASK_KEY}] web-search model call: ${Date.now() - t0}ms`);

  // Nitzan's own request, live this session — see monthlyCreditMarketScan.ts's
  // identical check: 0 real searches despite requesting web search is a
  // genuine access bug, not an unremarkable "nothing new this month."
  if (resp.webSearchesPerformed === 0) {
    return { ok: false, detail: `monthly VM0042 project scan: web search did not run at all this month (0 searches executed) — this is a real access failure, not an empty month.` };
  }

  const found = resp.kind === "text" ? parseProjects(resp.text) : [];
  const paragraphs: string[] = [
    `Web search ran (${resp.webSearchesPerformed ?? "?"} real search(es) executed) — every finding below carries its own real source.`,
  ];
  let inserted = 0;

  if (!found.length) {
    paragraphs.push("This month's search found no checkable, sourced project to add.");
  } else {
    for (const p of found) {
      // DO UPDATE, guarded to only fire when the issuer name is missing —
      // a genuinely new project always inserts; a project seen again just
      // backfills issuer_name if an earlier scan (before 0081) left it
      // null, rather than either duplicating the row or freezing it
      // forever at whatever the first scan happened to capture.
      const result = await query<{ scan_project_id: string }>(
        `INSERT INTO mrv.market_scan_projects (registry, methodology, issuer_name, project_name, location, credits_issued_note, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (registry, project_name) DO UPDATE SET issuer_name = excluded.issuer_name
           WHERE mrv.market_scan_projects.issuer_name IS NULL
         RETURNING scan_project_id`,
        [p.registry, p.methodology, p.issuer_name, p.project_name, p.location, p.credits_issued_note, p.source_url],
      );
      if (result.length) {
        inserted++;
        paragraphs.push(
          `New: "${p.issuer_name}" — ${p.project_name} (${p.registry}${p.methodology ? `, ${p.methodology}` : ""}) — ${p.credits_issued_note}. Source: ${p.source_url}`,
        );
      }
    }
    if (!inserted) paragraphs.push(`Found ${found.length} project(s), all already known from an earlier scan.`);
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Monthly VM0042 project scan — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "vm0042_project_scan",
    agentId: "john",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${inserted} new project(s) of ${found.length} found.)` };
}
