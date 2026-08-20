import "server-only";
import type { ToolContext } from "../tools/context";
import { TASK_KEY as WEEKLY_RESEARCH_ROUND_KEY, runWeeklyResearchRound } from "./scheduledTasks/weeklyResearchRound";
import { TASK_KEY as MONTHLY_PRODUCT_RESEARCH_KEY, runMonthlyProductResearch } from "./scheduledTasks/monthlyProductResearch";
import { TASK_KEY as WEEKLY_PDD_DEVELOPMENT_SCAN_KEY, runWeeklyPddDevelopmentScan } from "./scheduledTasks/weeklyPddDevelopmentScan";
import { TASK_KEY as WEEKLY_VERRA_WEBINAR_SCAN_KEY, runWeeklyVerraWebinarScan } from "./scheduledTasks/weeklyVerraWebinarScan";
import { TASK_KEY as BIWEEKLY_NEW_FARMER_CHECK_KEY, runBiweeklyNewFarmerCheck } from "./scheduledTasks/biweeklyNewFarmerCheck";

export interface ScheduledTaskOutcome {
  ok: boolean;
  detail: string;
}

export type ScheduledTaskHandler = (ctx: ToolContext) => Promise<ScheduledTaskOutcome>;

/**
 * The dispatch table for mrv.scheduled_tasks.task_key — the same
 * relationship toolRegistry.ts has to mrv.agents.tools.
 *
 * A task_key with no entry here is not an error in the dispatch loop —
 * it's recorded as `last_run_status = 'no_handler'`, so this table can
 * safely hold rows before their handler exists.
 *
 * Rebeka's 5 real tasks (0075) land here now; whichever ones John/Dave/
 * Ron/Jennifer get next are a deliberately separate follow-up.
 */
export const SCHEDULED_TASK_REGISTRY: Record<string, ScheduledTaskHandler> = {
  [WEEKLY_RESEARCH_ROUND_KEY]: runWeeklyResearchRound,
  [MONTHLY_PRODUCT_RESEARCH_KEY]: runMonthlyProductResearch,
  [WEEKLY_PDD_DEVELOPMENT_SCAN_KEY]: runWeeklyPddDevelopmentScan,
  [WEEKLY_VERRA_WEBINAR_SCAN_KEY]: runWeeklyVerraWebinarScan,
  [BIWEEKLY_NEW_FARMER_CHECK_KEY]: runBiweeklyNewFarmerCheck,
};
