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
const TIME_BUDGET_MS = 40_000; // leaves real headroom under the 60s hard cap — a single heavy task can still add several more seconds after this check passes
function advanceNextRun(current: Date, frequency: string): Date {
  const next = new Date(current);
  if (frequency === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
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
  }>(`SELECT task_id, agent_id, task_key, frequency, next_run_at FROM mrv.scheduled_tasks WHERE enabled AND next_run_at <= now()`);

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
        const outcome = await handler({ actor: "cron", actorKind: "agent", googleAccessToken });
        console.log(`[cron] ${row.task_key}: handler finished in ${Date.now() - handlerStart}ms`);
        status = outcome.ok ? "ok" : "error";
        detail = outcome.detail;
      } catch (e) {
        status = "error";
        detail = e instanceof Error ? e.message : String(e);
        console.log(`[cron] ${row.task_key}: handler threw — ${detail}`);
      }
    }

    let nextRunAt = new Date(row.next_run_at);
    while (nextRunAt.getTime() <= Date.now()) {
      nextRunAt = advanceNextRun(nextRunAt, row.frequency);
    }

    await query(
      `UPDATE mrv.scheduled_tasks
          SET last_run_at = clock_timestamp(), last_run_status = $2, last_run_detail = $3, next_run_at = $4, updated_at = clock_timestamp()
        WHERE task_id = $1`,
      [row.task_id, status, detail, nextRunAt.toISOString()],
    );

    await query(
      `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
       VALUES ('cron', 'run_scheduled_task', 'scheduled_task', $1, $2::jsonb)`,
      [row.task_id, JSON.stringify({ taskKey: row.task_key, agentId: row.agent_id, status, detail })],
    );

    results.push({ taskKey: row.task_key, status, detail });
  }

  return NextResponse.json({ checked: due.length, results, deferred });
}
