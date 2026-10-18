"use server";

import { auth } from "@/auth";
import { DATA_MODE } from "@/lib/env";

export interface RunScheduledTaskNowResult {
  ok: boolean;
  detail: string;
}

/**
 * The "Run Now" button on a scheduled-task card (ScheduledTasksPanel.tsx)
 * — a signed-in person triggering the exact same handler the cron route
 * would, right now, instead of waiting for next_run_at. Built for
 * dave_email_activity_ingestion (0122's 'manual' frequency — Nitzan's own
 * request: at launch, farmer emails are rare and personally solicited, so
 * he wants to tell Dave "go look now" the moment one arrives, not wait for
 * an automatic scan), but works for any task_key — a manual re-run of a
 * recurring one is just as legitimate a thing for a person to ask for.
 */
export async function runScheduledTaskNowAction(
  taskKey: string,
  taskParams?: Record<string, string>,
): Promise<RunScheduledTaskNowResult> {
  if (DATA_MODE === "fixtures") {
    return { ok: false, detail: "Scheduled tasks need the database — the module is running on fixtures." };
  }
  const session = await auth().catch(() => null);
  if (!session?.user?.email) {
    return { ok: false, detail: "Sign in to run a scheduled task." };
  }

  const { query } = await import("@/lib/db");
  const rows = await query<{ task_id: string; agent_id: string; frequency: string; next_run_at: string }>(
    `SELECT task_id, agent_id, frequency, next_run_at FROM mrv.scheduled_tasks WHERE task_key = $1`,
    [taskKey],
  );
  if (!rows.length) {
    return { ok: false, detail: `No scheduled task "${taskKey}".` };
  }
  const row = rows[0];

  const { runScheduledTaskNow } = await import("./runScheduledTaskNow");
  const result = await runScheduledTaskNow(
    { taskId: row.task_id, agentId: row.agent_id, taskKey, frequency: row.frequency, nextRunAt: row.next_run_at },
    `manual:${session.user.email}`,
    taskParams,
  );

  return { ok: result.status === "ok", detail: result.detail };
}
