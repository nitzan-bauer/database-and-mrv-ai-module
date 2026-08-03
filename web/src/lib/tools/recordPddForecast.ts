import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface PddForecastInput {
  projectId: string;
  vintageStart: string;
  vintageEnd: string;
  estimatedNetTco2e: number;
}

export interface RecordedPddForecast {
  forecastId: string;
  projectId: string;
  vintageStart: string;
  vintageEnd: string;
  estimatedNetTco2e: number;
}

/**
 * Record one vintage period of the VCS PDD Template v5.0A's own
 * "estimated net reductions and removals" table — the PDD's declared
 * forecast, which existed only as a table description in the template
 * until now. Revisable: a vintage already recorded is upserted rather
 * than duplicated, since a forecast is re-stated as the PDD itself is
 * redrafted, the same standing record_mvr_signoff gives an MVR moving
 * through its own stages.
 */
export async function recordPddForecast(
  ctx: ToolContext,
  input: PddForecastInput,
): Promise<ToolResult<RecordedPddForecast>> {
  const guard = requireDbMode("recordPddForecast");
  if (guard) return guard;

  const policy = await checkPolicy("record_pdd_forecast", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.vintageStart?.trim() || Number.isNaN(Date.parse(input.vintageStart))) {
    return fail(`recordPddForecast: vintageStart "${input.vintageStart}" is not a valid date.`);
  }
  if (!input.vintageEnd?.trim() || Number.isNaN(Date.parse(input.vintageEnd))) {
    return fail(`recordPddForecast: vintageEnd "${input.vintageEnd}" is not a valid date.`);
  }
  if (new Date(input.vintageEnd) < new Date(input.vintageStart)) {
    return fail("recordPddForecast: vintageEnd is before vintageStart.");
  }
  if (!Number.isFinite(input.estimatedNetTco2e)) {
    return fail("recordPddForecast: estimatedNetTco2e must be a finite number.");
  }

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("recordPddForecast: no such project.");

  const rows = await query<{ forecast_id: string }>(
    `INSERT INTO mrv.pdd_forecast_vintages (project_id, vintage_start, vintage_end, estimated_net_tco2e, recorded_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, vintage_start, vintage_end) DO UPDATE SET
       estimated_net_tco2e = excluded.estimated_net_tco2e,
       recorded_by = excluded.recorded_by,
       updated_at = clock_timestamp()
     RETURNING forecast_id`,
    [input.projectId, input.vintageStart, input.vintageEnd, input.estimatedNetTco2e, ctx.actor],
  );
  const forecastId = rows[0].forecast_id;

  await audit(ctx, "record_pdd_forecast", { type: "pdd_forecast_vintage", id: forecastId }, {
    projectId: input.projectId,
    vintageStart: input.vintageStart,
    vintageEnd: input.vintageEnd,
    estimatedNetTco2e: input.estimatedNetTco2e,
  });

  return ok({
    forecastId,
    projectId: input.projectId,
    vintageStart: input.vintageStart,
    vintageEnd: input.vintageEnd,
    estimatedNetTco2e: input.estimatedNetTco2e,
  });
}
