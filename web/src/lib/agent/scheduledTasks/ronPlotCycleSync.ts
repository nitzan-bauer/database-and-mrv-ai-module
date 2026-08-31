import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "ron_plot_cycle_sync";

/**
 * Syncs mrv.plot_crop_cycles from each plot's real info-window data in the
 * SaaS (plots.geojson.properties) — the "smart table" Nitzan asked for
 * (2026-08-26). Read-only mirror: this never writes back to the SaaS.
 * plot_type is looked up from mrv.project_plot_type_defaults (already
 * built in Phase 1) rather than a new classification.
 */
export async function runRonPlotCycleSync(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { listAllSaasPlotCropCycles } = await import("../../saas/saasClient");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  let plots;
  try {
    plots = await listAllSaasPlotCropCycles();
  } catch (e) {
    return { ok: false, detail: `ron_plot_cycle_sync: could not reach the SaaS database — ${e instanceof Error ? e.message : e}` };
  }

  const defaults = await query<{ project_id: string; default_plot_type: string }>(`SELECT project_id, default_plot_type FROM mrv.project_plot_type_defaults`);
  const plotTypeByProject = new Map(defaults.map((d) => [d.project_id, d.default_plot_type]));

  let synced = 0;
  for (const plot of plots) {
    if (!plot.farm_id) continue; // unassigned/template plot
    await query(
      `INSERT INTO mrv.plot_crop_cycles (plot_id, farm_id, project_id, plot_type, crop, planting_date, agri_inputs, plants_density, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())
       ON CONFLICT (plot_id) DO UPDATE SET
         farm_id = EXCLUDED.farm_id, project_id = EXCLUDED.project_id, plot_type = EXCLUDED.plot_type,
         crop = EXCLUDED.crop, planting_date = EXCLUDED.planting_date, agri_inputs = EXCLUDED.agri_inputs,
         plants_density = EXCLUDED.plants_density, synced_at = now()`,
      [
        plot.id,
        plot.farm_id,
        plot.project_id,
        plotTypeByProject.get(plot.project_id) ?? null,
        plot.crop,
        plot.planting_date,
        JSON.stringify(plot.agri_inputs ?? []),
        plot.plants_density,
      ],
    );
    synced++;
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Plot crop-cycle sync — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: [`Synced crop-cycle info for ${synced} plot(s) from their SaaS info-window data.`],
    memoryKind: "plot_cycle_sync",
    sendEmail: false, // feeds ron_crop_cycle_reminder, which is the one that emails Nitzan when there's something to report
    agentId: "ron",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (synced: ${synced}.)` };
}
