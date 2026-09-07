import { NextResponse } from "next/server";
import { SCHEDULED_TASK_REGISTRY } from "@/lib/agent/scheduledTaskRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Vercel Hobby ceiling — without this the platform default (10s) cuts
// a handler off mid-request. Confirmed live this session: the first real
// run got through search_verra_registry and was killed partway through
// the drafting pass that followed, with no error ever written back
// because the whole function was terminated, not thrown into.
export const maxDuration = 60;

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
// running — so it has to leave enough of the 60s hard cap for the
// single worst-case handler that starts right at the edge of the budget.
// Measured worst case, not guessed: John's monthly market-scan handlers
// call the model with webSearch (timeoutMs up to 30_000, anthropicProvider.ts)
// then, via finalizeScheduledTaskRun, recordLesson's own completion call
// (COMPLETE_TIMEOUT_MS = 15_000) — up to ~45s in model calls alone before
// counting the Google-token fetch and DB round trips around them. 40_000
// left only 20s of runway for that, so a task starting late in the window
// could push the whole invocation past 60s and get killed by Vercel
// mid-handler with nothing recorded — the exact silent-failure mode
// maxDuration was raised to fix in the first place. 10s leaves ~50s of
// runway, comfortably covering the ~45s worst case with margin for
// per-task DB/auth overhead.
const TIME_BUDGET_MS = 10_000;

// Confirmed live 2026-09-06/07: with no per-handler backstop, one hung
// handler (picked up in whatever order Postgres happened to return —
// the query had no ORDER BY) ran past the 45s "worst case" this file's
// own comment above assumed, ate the full 60s maxDuration, and Vercel
// force-killed the whole invocation before a single row — out of 8 due
// that run — got a chance to write back a result. Nothing was lost
// (next_run_at is untouched until a row's own UPDATE runs), but nothing
// progressed either, and the same due set could stall the exact same way
// on every subsequent tick if Postgres keeps returning that row first.
// HANDLER_TIMEOUT_MS below is the real backstop: it makes the loop move
// on regardless, by racing the handler against a rejection. It cannot
// actually cancel the handler's in-flight work (Node has no true
// cancellation for an arbitrary async function) — if the real handler
// finishes later on its own, its DB writes still land, just after this
// invocation already recorded the row as "error: timed out" and gave it
// a fresh next_run_at. That's a late write, not a double-run: the next
// cron tick isn't what re-triggers it (next_run_at already moved
// forward), so there's no risk of the same task executing twice
// concurrently from this path.
const HANDLER_TIMEOUT_MS = 45_000;
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}
function advanceNextRun(current: Date, frequency: string): Date {
  const next = new Date(current);
  if (frequency === "bimonthly") {
    next.setUTCMonth(next.getUTCMonth() + 2);
  } else if (frequency === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else if (frequency === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else {
    next.setUTCDate(next.getUTCDate() + (frequency === "biweekly" ? 14 : 7));
  }
  return next;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { query } = await import("@/lib/db");
  const { getServiceGoogleAccessToken } = await import("@/lib/google/serviceAuth");

  const due = await query<{
    task_id: string;
    agent_id: string;
    task_key: string;
    frequency: string;
    next_run_at: string;
  }>(
    `SELECT task_id, agent_id, task_key, frequency, next_run_at FROM mrv.scheduled_tasks
      WHERE enabled AND next_run_at <= now()
      ORDER BY next_run_at ASC`,
  );

  const results: Array<{ taskKey: string; status: string; detail: string }> = [];
  const deferred: string[] = [];
  const startedAt = Date.now();

  // The one real connected Workspace identity in this system today —
  // every scheduled task authenticates to Google as Nitzan, the same
  // way a person clicking a button does now (see serviceAuth.ts).
  const serviceEmail = process.env.CRON_GOOGLE_ACCOUNT_EMAIL?.trim() || "nitzan@carbonature.io";

  for (const row of due) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      deferred.push(row.task_key);
      continue; // next_run_at untouched — this row is still due on the next invocation
    }

    let status: "ok" | "error" | "no_handler" = "no_handler";
    let detail = `no handler registered for "${row.task_key}"`;

    const handler = SCHEDULED_TASK_REGISTRY[row.task_key];
    if (handler) {
      try {
        const tokenStart = Date.now();
        const googleAccessToken = (await getServiceGoogleAccessToken(query, serviceEmail)) ?? undefined;
        console.log(`[cron] ${row.task_key}: got access token in ${Date.now() - tokenStart}ms (present: ${Boolean(googleAccessToken)})`);
        const handlerStart = Date.now();
        // The real agent id, not the generic "cron" trigger mechanism —
        // already sitting right here on the due row. Audit/learning
        // queries group by actor to compute a per-agent picture (0078's
        // agent-learning plan); "cron" as the actor would attribute
        // every scheduled task, for every agent, to the same identity.
        const outcome = await withTimeout(
          handler({ actor: row.agent_id, actorKind: "agent", googleAccessToken }),
          HANDLER_TIMEOUT_MS,
          row.task_key,
        );
        console.log(`[cron] ${row.task_key}: handler finished in ${Date.now() - handlerStart}ms`);
        status = outcome.ok ? "ok" : "error";
        detail = outcome.detail;
      } catch (e) {
        status = "error";
        detail = e instanceof Error ? e.message : String(e);
        console.log(`[cron] ${row.task_key}: handler threw — ${detail}`);
      }
    }

    // Confirmed live 2026-09-06: a genuine one-off failure (Dave's first
    // real sampling-plan task timed out against Anthropic) used to
    // advance next_run_at by the full frequency interval regardless —
    // for a bimonthly task that meant no retry until two months later.
    // On error, leave next_run_at untouched: the row is still due, so
    // the very next cron tick (or a manual trigger) retries it, exactly
    // like a row this invocation ran out of time budget for.
    let nextRunAt = new Date(row.next_run_at);
    if (status !== "error") {
      while (nextRunAt.getTime() <= Date.now()) {
        nextRunAt = advanceNextRun(nextRunAt, row.frequency);
      }
    }

    await query(
      `UPDATE mrv.scheduled_tasks
          SET last_run_at = clock_timestamp(), last_run_status = $2, last_run_detail = $3, next_run_at = $4, updated_at = clock_timestamp()
        WHERE task_id = $1`,
      [row.task_id, status, detail, nextRunAt.toISOString()],
    );

    await query(
      `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
       VALUES ($1, 'run_scheduled_task', 'scheduled_task', $2, $3::jsonb)`,
      [row.agent_id, row.task_id, JSON.stringify({ taskKey: row.task_key, triggeredBy: "cron", status, detail })],
    );

    results.push({ taskKey: row.task_key, status, detail });
  }

  return NextResponse.json({ checked: due.length, results, deferred });
}
