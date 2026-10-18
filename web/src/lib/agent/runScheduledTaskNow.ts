import "server-only";
import { SCHEDULED_TASK_REGISTRY } from "./scheduledTaskRegistry";

/**
 * The single place a scheduled task's handler is actually invoked and its
 * result recorded — shared by the cron route (route.ts, one row at a time
 * for every task due today) and a human's own "Run Now" click
 * (runScheduledTaskNowAction.ts, for a frequency='manual' task like
 * dave_email_activity_ingestion — 0122). Extracted so the two triggers
 * can never quietly drift into recording last_run_status/next_run_at
 * differently from each other.
 */

// Confirmed live 2026-09-06/07: with no per-handler backstop, one hung
// handler ran past the "worst case" this file used to assume, ate the
// full maxDuration, and Vercel force-killed the whole cron invocation
// before a single row got a chance to write back a result. This is the
// real backstop: it makes the loop move on regardless, by racing the
// handler against a rejection. It cannot actually cancel the handler's
// in-flight work (Node has no true cancellation for an arbitrary async
// function) — if the real handler finishes later on its own, its DB
// writes still land, just after this call already recorded the row as
// "error: timed out" and (for a non-manual row) gave it a fresh
// next_run_at. That's a late write, not a double-run.
const HANDLER_TIMEOUT_MS = 240_000;
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

export interface RunScheduledTaskResult {
  status: "ok" | "error" | "no_handler";
  detail: string;
}

/**
 * Runs one due (or manually-triggered) row's handler and writes back
 * last_run_at/last_run_status/last_run_detail — and, for anything other
 * than a 'manual' frequency, next_run_at (advanced past now(), or left
 * untouched on error so the row stays due for a retry). 'manual' rows
 * never get next_run_at touched here: there is no "next" run to compute,
 * only the next click.
 */
export async function runScheduledTaskNow(
  row: { taskId: string; agentId: string; taskKey: string; frequency: string; nextRunAt: string },
  triggeredBy: string,
  taskParams?: Record<string, string>,
): Promise<RunScheduledTaskResult> {
  const { query } = await import("../db");
  const { getServiceGoogleAccessToken } = await import("../google/serviceAuth");

  let status: "ok" | "error" | "no_handler" = "no_handler";
  let detail = `no handler registered for "${row.taskKey}"`;

  const handler = SCHEDULED_TASK_REGISTRY[row.taskKey];
  if (handler) {
    try {
      const serviceEmail = process.env.CRON_GOOGLE_ACCOUNT_EMAIL?.trim() || "nitzan@carbonature.io";
      const googleAccessToken = (await getServiceGoogleAccessToken(query, serviceEmail)) ?? undefined;
      const outcome = await withTimeout(
        handler({ actor: row.agentId, actorKind: "agent", googleAccessToken, taskParams }),
        HANDLER_TIMEOUT_MS,
        row.taskKey,
      );
      status = outcome.ok ? "ok" : "error";
      detail = outcome.detail;
    } catch (e) {
      status = "error";
      detail = e instanceof Error ? e.message : String(e);
    }
  }

  let nextRunAt = new Date(row.nextRunAt);
  if (row.frequency !== "manual" && status !== "error") {
    while (nextRunAt.getTime() <= Date.now()) {
      nextRunAt = advanceNextRun(nextRunAt, row.frequency);
    }
  }

  await query(
    `UPDATE mrv.scheduled_tasks
        SET last_run_at = clock_timestamp(), last_run_status = $2, last_run_detail = $3, next_run_at = $4, updated_at = clock_timestamp()
      WHERE task_id = $1`,
    [row.taskId, status, detail, nextRunAt.toISOString()],
  );

  await query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
     VALUES ($1, 'run_scheduled_task', 'scheduled_task', $2, $3::jsonb)`,
    [row.agentId, row.taskId, JSON.stringify({ taskKey: row.taskKey, triggeredBy, status, detail, taskParams })],
  );

  return { status, detail };
}
