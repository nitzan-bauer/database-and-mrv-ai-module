import { NextResponse } from "next/server";
import { runScheduledTaskNow } from "@/lib/agent/runScheduledTaskNow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Confirmed directly against Vercel's own docs (vercel.com/docs/functions/limitations,
// checked 2026-09-08): with Fluid compute — already on by default for
// this project, created 2026-08-20 — Hobby's real ceiling is 300s, not
// 60s. The 60s figure earlier here was inherited from an older
// assumption, never actually verified against the current platform
// limit. 280 leaves a 20s margin under the true 300s hard cap. This
// still matters: without SOME maxDuration override the platform default
// (10s) cuts a handler off mid-request — confirmed live this session,
// the first real run got through search_verra_registry and was killed
// partway through the drafting pass that followed, with no error ever
// written back because the whole function was terminated, not thrown
// into.
export const maxDuration = 280;

/**
 * The one entry point every agent's recurring task runs through
 * (Nitzan's own request, live this session: infra generic enough for
 * John/Rebeka/Dave/Ron/Jennifer alike, not just Rebeka's 5). Triggered
 * daily by Vercel Cron (vercel.json) — the coarse trigger is fine
 * because this route's own `next_run_at` check is what actually
 * enforces weekly/biweekly/monthly, not the cron schedule itself.
 *
 * Each due row is handled in its own try/catch (same isolation
 * principle as runPddGeneratorPipeline.ts's own step-by-step guards) —
 * one broken task's Google auth failure or a thrown handler must never
 * stop the rest of the day's due tasks from running.
 *
 * Even with maxDuration raised, several heavy handlers (each doing a
 * handful of sequential LLM calls) can still add up to more than one
 * invocation's budget when several are due the same day. A row this
 * invocation doesn't get to is simply left with its next_run_at
 * unchanged — still due, so the next cron tick (or a manual "Run now")
 * picks it up rather than the whole request dying mid-task with nothing
 * recorded for the tasks after it.
 */
// This only gates STARTING another task — it can't interrupt one already
// running — so it has to leave enough of the real 300s Hobby ceiling
// (see maxDuration above) for the single worst-case handler that starts
// right at the edge of the budget. 30_000 leaves 250s of runway before
// the 280s maxDuration cutoff, comfortably covering HANDLER_TIMEOUT_MS
// below with margin for per-task DB/auth overhead.
const TIME_BUDGET_MS = 30_000;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { query } = await import("@/lib/db");

  const due = await query<{
    task_id: string;
    agent_id: string;
    task_key: string;
    frequency: string;
    next_run_at: string;
  }>(
    // frequency = 'manual' is excluded here, not just given a far-future
    // next_run_at: a task like dave_email_activity_ingestion (0122) is
    // deliberately never auto-run — it only fires from the "Run Now"
    // control in its own scheduled-tasks panel (runScheduledTaskNow.ts).
    `SELECT task_id, agent_id, task_key, frequency, next_run_at FROM mrv.scheduled_tasks
      WHERE enabled AND frequency != 'manual' AND next_run_at <= now()
      ORDER BY next_run_at ASC`,
  );

  const results: Array<{ taskKey: string; status: string; detail: string }> = [];
  const deferred: string[] = [];
  const startedAt = Date.now();

  for (const row of due) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      deferred.push(row.task_key);
      continue; // next_run_at untouched — this row is still due on the next invocation
    }

    const { status, detail } = await runScheduledTaskNow(
      { taskId: row.task_id, agentId: row.agent_id, taskKey: row.task_key, frequency: row.frequency, nextRunAt: row.next_run_at },
      "cron",
    );

    results.push({ taskKey: row.task_key, status, detail });
  }

  return NextResponse.json({ checked: due.length, results, deferred });
}
