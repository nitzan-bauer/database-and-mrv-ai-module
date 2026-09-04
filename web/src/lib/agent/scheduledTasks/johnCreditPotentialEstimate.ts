import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_credit_potential_estimate";

/**
 * Pre-sampling credit-yield potential, computed for every plot (sold or
 * not) — the campaign launches well before any real soil-sampling round,
 * so this is the only "how many credits could this farm generate" number
 * available for most of the plan's life. Plot type AND rate resolve
 * together per plot (plotTypeResolver.ts#resolvePlotAndRate), sourced live
 * from the SaaS's own settings — the same per-project credit-yield rates
 * and orchard-age threshold (young vs. mature, e.g. 9 vs. 3 tCO2e/ha) an
 * admin edits in the SaaS's own Settings panel, plus each plot's real
 * planting_date. A farm's manual mrv.farm_plot_type_overrides row still
 * wins if set, for the rare case the real data is wrong or missing. MRV
 * keeps no separate copy of these rates — one place to edit them, 2026-09-01.
 *
 * Upserts one 'rate_table' row per plot (idx_credit_yield_estimates_plot_method
 * is unique on (plot_id, method)) — safe to re-run every week as the rate
 * table or plot list changes; existing 'sampled'/'ml_predicted' rows for the
 * same plot are untouched.
 */
export async function runJohnCreditPotentialEstimate(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listAllSaasPlots } = await import("../../saas/saasClient");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  let plots;
  try {
    plots = await listAllSaasPlots();
  } catch (e) {
    return { ok: false, detail: `john_credit_potential_estimate: could not reach the SaaS database — ${e instanceof Error ? e.message : e}` };
  }

  const { loadPlotTypeContext, resolvePlotAndRate } = await import("./plotTypeResolver");
  const farmIds = [...new Set(plots.map((p) => p.farm_id).filter((id): id is string => Boolean(id)))];
  const plotTypeContext = await loadPlotTypeContext(farmIds);

  let written = 0;
  let skippedNoMapping = 0;

  for (const plot of plots) {
    if (!plot.farm_id) continue; // an unassigned/template plot, not a real farm's
    const resolved = resolvePlotAndRate(plotTypeContext, plot.farm_id, plot.id);
    if (!resolved) {
      skippedNoMapping++;
      continue;
    }
    const { plotType, ratePerHa: rate } = resolved;
    const estimatedCredits = rate * Number(plot.area_ha);
    await query(
      `INSERT INTO mrv.credit_yield_estimates (plot_id, farm_id, project_id, plot_type, area_ha, rate_per_ha, estimated_credits, method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'rate_table')
       ON CONFLICT (plot_id, method) DO UPDATE SET
         area_ha = EXCLUDED.area_ha, rate_per_ha = EXCLUDED.rate_per_ha,
         estimated_credits = EXCLUDED.estimated_credits, estimated_at = now()`,
      [plot.id, plot.farm_id, plot.project_id, plotType, Number(plot.area_ha), rate, estimatedCredits],
    );
    written++;
  }

  const paragraphs = [
    `Computed/refreshed potential-credit estimates for ${written} plot(s).`,
    skippedNoMapping ? `${skippedNoMapping} plot(s) skipped — no resolvable SaaS financing project for their farm's crops.` : `Every plot resolved to a plot type.`,
  ];

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Credit-yield potential estimate — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "credit_potential_estimate",
    sendEmail: false, // this task's output feeds john_allocation_report, which is the one that actually emails Nitzan
    agentId: "john",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (written: ${written}, skipped: ${skippedNoMapping}.)` };
}
