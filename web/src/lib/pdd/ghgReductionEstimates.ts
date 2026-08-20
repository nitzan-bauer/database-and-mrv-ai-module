import "server-only";
import type { GhgReductionRow } from "./injectPddTemplate";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDdMmmYyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/**
 * One row per calendar year the crediting period actually spans — the
 * first and last rows are partial years (matching Verra's own template
 * example, which shows a partial first period and a partial final one),
 * every year in between is a full Jan 1 – Dec 31 span.
 */
function buildVintagePeriods(creditingStart: Date, creditingEnd: Date): { start: Date; end: Date }[] {
  const periods: { start: Date; end: Date }[] = [];
  let cursor = new Date(creditingStart);
  while (cursor < creditingEnd) {
    const yearEnd = new Date(Date.UTC(cursor.getUTCFullYear(), 11, 31));
    const periodEnd = yearEnd < creditingEnd ? yearEnd : new Date(creditingEnd);
    periods.push({ start: new Date(cursor), end: periodEnd });
    cursor = new Date(periodEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return periods;
}

/**
 * Builds the real, current-crediting-period rows for the GHG reductions
 * table from mrv.ghg_reduction_estimates — the founder's own draft
 * figures, one per vintage year, nothing invented on top. A year with no
 * row of its own yet continues at the rate of the most recent year the
 * founder actually gave (Nitzan's own explicit instruction — not this
 * build's guess), and that continuation is written back with
 * source='extrapolated' so it's visible and re-derivable, never confused
 * with a year he actually typed in. ON CONFLICT ... WHERE guards against
 * ever overwriting a human_provided row with an extrapolated one.
 */
export async function getGhgReductionRows(
  query: <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>,
  projectId: string,
  creditingStart: Date,
  creditingEnd: Date,
): Promise<GhgReductionRow[]> {
  const periods = buildVintagePeriods(creditingStart, creditingEnd);
  if (!periods.length) return [];

  const existing = await query<{ vintage_year: number; total_net_reductions_tco2e: string; source: string }>(
    `SELECT vintage_year, total_net_reductions_tco2e, source FROM mrv.ghg_reduction_estimates WHERE project_id = $1`,
    [projectId],
  );
  const byYear = new Map(existing.map((r) => [r.vintage_year, { total: Number(r.total_net_reductions_tco2e), source: r.source }]));

  const humanRows = existing.filter((r) => r.source === "human_provided");
  const lastHumanYear = humanRows.length ? Math.max(...humanRows.map((r) => r.vintage_year)) : null;
  const lastHumanValue = lastHumanYear !== null ? Number(byYear.get(lastHumanYear)!.total) : null;

  const rows: GhgReductionRow[] = [];
  for (const period of periods) {
    const labelYear = period.start.getUTCFullYear();
    const known = byYear.get(labelYear);

    let total: number;
    let extrapolated: boolean;
    if (known) {
      total = known.total;
      extrapolated = known.source === "extrapolated";
    } else if (lastHumanValue !== null) {
      total = lastHumanValue;
      extrapolated = true;
      await query(
        `INSERT INTO mrv.ghg_reduction_estimates (project_id, vintage_year, total_net_reductions_tco2e, source, extrapolation_rule)
         VALUES ($1, $2, $3, 'extrapolated', 'repeat_last_human_provided_rate')
         ON CONFLICT (project_id, vintage_year) DO UPDATE SET
           total_net_reductions_tco2e = excluded.total_net_reductions_tco2e,
           extrapolation_rule = excluded.extrapolation_rule,
           updated_at = clock_timestamp()
         WHERE mrv.ghg_reduction_estimates.source = 'extrapolated'`,
        [projectId, labelYear, total],
      );
    } else {
      continue; // no founder-given figure exists at all yet — nothing honest to show for this year
    }

    rows.push({
      startDisplay: formatDdMmmYyyy(period.start),
      endDisplay: formatDdMmmYyyy(period.end),
      totalTco2e: total,
      extrapolated,
    });
  }
  return rows;
}
