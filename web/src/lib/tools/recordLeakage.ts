import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface RecordedLeakage {
  leakageId: string;
  component: "8.4.2" | "8.4.3" | "8.4.4";
  leakageTco2e: number;
}

/**
 * Record a manually-justified VM0042 §8.4 leakage line — §8.4.2, §8.4.3 or
 * §8.4.4. §8.4.1 (new/additional organic amendments) is deliberately not
 * accepted here: it is computed automatically from activity data (see
 * engine.ts's computeLeakage841) and has no manual-entry path, so the two
 * can never disagree.
 *
 * A justification is required, not optional — an unjustified leakage
 * figure is exactly what a VVB flags, and this table has no formula behind
 * it to fall back on the way §8.4.1 does.
 */
export async function recordLeakage(
  ctx: ToolContext,
  input: {
    farmId?: string;
    projectId?: string;
    component: "8.4.2" | "8.4.3" | "8.4.4";
    year?: number;
    leakageTco2e: number;
    justification: string;
  },
): Promise<ToolResult<RecordedLeakage>> {
  const guard = requireDbMode("recordLeakage");
  if (guard) return guard;

  const policy = await checkPolicy("record_leakage", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.farmId && !input.projectId) {
    return fail("recordLeakage: needs a farmId or a projectId to attach the entry to.");
  }
  if (!["8.4.2", "8.4.3", "8.4.4"].includes(input.component)) {
    return fail("recordLeakage: component must be 8.4.2, 8.4.3 or 8.4.4 — 8.4.1 is computed automatically, not entered.");
  }
  if (!Number.isFinite(input.leakageTco2e) || input.leakageTco2e < 0) {
    return fail("recordLeakage: leakageTco2e cannot be negative.");
  }
  if (!input.justification?.trim()) {
    return fail("recordLeakage: a justification is required — an unjustified leakage figure is exactly what a VVB flags.");
  }
  if (input.year != null && (!Number.isInteger(input.year) || input.year < 1990 || input.year > 2100)) {
    return fail("recordLeakage: year looks wrong.");
  }

  const { query } = await import("../db");

  if (input.farmId) {
    const farms = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.farms WHERE farm_id = $1`, [
      input.farmId,
    ]);
    if (Number(farms[0].n) === 0) return fail("recordLeakage: no such farm.");
  }
  if (input.projectId) {
    const projects = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`,
      [input.projectId],
    );
    if (Number(projects[0].n) === 0) return fail("recordLeakage: no such project.");
  }

  const rows = await query<{ leakage_id: string }>(
    `INSERT INTO mrv.leakage (farm_id, project_id, component, year, leakage_tco2e, justification)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING leakage_id`,
    [input.farmId ?? null, input.projectId ?? null, input.component, input.year ?? null, input.leakageTco2e, input.justification],
  );
  const leakageId = rows[0].leakage_id;

  await audit(ctx, "record_leakage", { type: "leakage", id: leakageId }, {
    farmId: input.farmId,
    projectId: input.projectId,
    component: input.component,
    year: input.year,
    leakageTco2e: input.leakageTco2e,
  });

  return ok({ leakageId, component: input.component, leakageTco2e: input.leakageTco2e });
}
