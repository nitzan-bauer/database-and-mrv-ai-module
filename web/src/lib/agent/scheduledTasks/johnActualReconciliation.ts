import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_actual_reconciliation";

/**
 * Fills in the "actual" vector (credits_tco2e_actual) once real MRV/soil-
 * sampling data exists for a farm — the counterpart to the "potential"
 * vector every allocation starts with. Confirmed live (2026-08-25, via
 * db:doctor) that mrv.plot_samples / mrv.plot_soc / mrv.model_runs /
 * mrv.model_results all have zero rows today — no farm has been through a
 * real sampling cycle yet, so this task is expected to find nothing to do
 * for a long time. That is the documented, correct behavior, not a bug.
 *
 * The real signal this checks for is mrv.vcu_issuances with status='issued'
 * (Verra's own post-verification unit, at the grouped-project level) —
 * NOT mrv.credits, which migration 0012 itself documents as still an
 * ex-ante/planning figure ("real credits are only known after
 * verification"). Deliberately NOT implemented here: automatically
 * attributing one project-level VCU issuance down to individual farms'
 * credits_tco2e_actual. That attribution rule (pro-rata by potential? by
 * verified SOC delta per farm from mrv.model_results?) doesn't exist yet
 * anywhere in this codebase and would be inventing a scientific/financial
 * rule with no example to check it against — this task instead surfaces a
 * real issuance immediately via email so Nitzan/John decide the
 * attribution the first time it actually happens, rather than guessing
 * silently now.
 */
export async function runJohnActualReconciliation(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  // No table yet tracks "this issuance has already been reconciled" — with
  // zero issuances existing today, every real one found here is by
  // definition new. Building that tracking table is part of the human
  // decision flagged below, once a first real issuance actually exists.
  const issuances = await query<{ issuance_id: string; project_id: string; quantity_tco2e: string | null; verra_serial_range: string | null; issued_date: string | null }>(
    `SELECT issuance_id, project_id, quantity_tco2e, verra_serial_range, issued_date
       FROM mrv.vcu_issuances
      WHERE status = 'issued' AND NOT is_demo`,
  );

  // Any allocation row still short of a reconciled actual figure, for the
  // shortfall alert — a farm-level "we sold more than we can now verify"
  // check, once real data exists to compare against.
  const shortfalls = await query<{ farm_id: string; potential: string; actual: string }>(
    `SELECT farm_id, SUM(credits_tco2e_potential) AS potential, SUM(COALESCE(credits_tco2e_actual, 0)) AS actual
       FROM mrv.allocation_register
      WHERE farm_id IS NOT NULL AND status <> 'released' AND credits_tco2e_actual IS NOT NULL
      GROUP BY farm_id
     HAVING SUM(COALESCE(credits_tco2e_actual, 0)) < SUM(credits_tco2e_potential)`,
  );

  const paragraphs: string[] = [];
  let alertNeeded = false;

  if (!issuances.length) {
    paragraphs.push(
      "No new real Verra VCU issuances found (mrv.vcu_issuances, status='issued', non-demo) — no farm has completed a real sampling/verification cycle yet. This is expected at this stage, not a failure.",
    );
  } else {
    alertNeeded = true;
    paragraphs.push(`${issuances.length} new real VCU issuance(s) found — this needs a human decision, not an automatic one:`);
    for (const i of issuances) {
      paragraphs.push(
        `- Issuance ${i.issuance_id} (project ${i.project_id}): ${i.quantity_tco2e ?? "?"} tCO2e, serial range ${i.verra_serial_range ?? "not recorded"}, issued ${i.issued_date ?? "?"}. This is the FIRST real issuance — there is no farm-level attribution rule defined yet for splitting a project-level VCU issuance into each farm's credits_tco2e_actual. Needs a decision before this can be reconciled automatically.`,
      );
    }
  }

  if (shortfalls.length) {
    alertNeeded = true;
    paragraphs.push(`${shortfalls.length} farm(s) show verified actual credits BELOW what's already been sold against potential — review needed:`);
    for (const s of shortfalls) {
      paragraphs.push(`- Farm ${s.farm_id}: sold ${s.potential} tCO2e (potential), verified only ${s.actual} tCO2e (actual).`);
    }
  } else {
    paragraphs.push("No farm shows verified actual credits below what's already been sold — no shortfall to flag.");
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Actual-vector reconciliation — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "actual_reconciliation",
    sendEmail: alertNeeded, // immediate alert per the double-counting design, not batched into the weekly report only
    agentId: "john",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (new issuances: ${issuances.length}, shortfalls: ${shortfalls.length}.)` };
}
