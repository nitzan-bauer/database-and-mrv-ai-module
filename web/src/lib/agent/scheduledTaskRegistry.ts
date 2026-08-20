import "server-only";
import type { ToolContext } from "../tools/context";

export interface ScheduledTaskOutcome {
  ok: boolean;
  detail: string;
}

export type ScheduledTaskHandler = (ctx: ToolContext) => Promise<ScheduledTaskOutcome>;

/**
 * The dispatch table for mrv.scheduled_tasks.task_key — the same
 * relationship toolRegistry.ts has to mrv.agents.tools. Empty today on
 * purpose: this file is the infrastructure that makes a scheduled task
 * runnable at all (src/app/api/cron/run-scheduled-tasks/route.ts calls
 * into it), landing before any of the real tasks it will eventually
 * dispatch to (Rebeka's 5 weekly/monthly/biweekly tasks, and whichever
 * ones John/Dave/Ron/Jennifer get next) — those are a deliberately
 * separate follow-up, not part of this round.
 *
 * A task_key with no entry here is not an error in the dispatch loop —
 * it's recorded as `last_run_status = 'no_handler'`, so this table can
 * safely hold rows (even real ones Nitzan wants scheduled) before their
 * handler exists yet.
 */
export const SCHEDULED_TASK_REGISTRY: Record<string, ScheduledTaskHandler> = {};
