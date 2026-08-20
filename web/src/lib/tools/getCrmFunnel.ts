import "server-only";
import { checkCrmPolicy, crmAudit, ok, fail, type ToolContext, type ToolResult } from "./crmContext";

export interface CrmFunnelStage {
  stage: string;
  sortOrder: number;
  count: number;
  conversionFromPrevPct: number | null;
}

export interface CrmFunnelResult {
  leadType: "farmer" | "credit_buyer";
  totalLeads: number;
  stages: CrmFunnelStage[];
}

/**
 * Shared implementation behind Ron's two funnel skills — farmer_funnel
 * ("Funnel A") and buyer_funnel ("Funnel B") in the spec are the same
 * count-per-stage query over crm.leads, just filtered to a different
 * lead_type, so one function serves both action names.
 *
 * conversionFromPrevPct is how many of the PREVIOUS stage's leads are
 * still present at this stage or later (i.e. didn't drop off before
 * reaching here) — the standard funnel-conversion definition, not simply
 * this stage's count over the previous stage's count (which would read as
 * a drop even when leads have moved further down the funnel, not lost).
 */
async function funnelStageCounts(leadType: "farmer" | "credit_buyer"): Promise<CrmFunnelResult> {
  const { crmQuery } = await import("../crmDb");

  const stages = await crmQuery<{ name: string; sort_order: number }>(
    `SELECT name, sort_order FROM crm.pipeline_stages WHERE lead_type = $1 ORDER BY sort_order`,
    [leadType],
  );

  const counts = await crmQuery<{ current_stage: string; n: string }>(
    `SELECT current_stage, count(*)::text AS n FROM crm.leads WHERE lead_type = $1 GROUP BY current_stage`,
    [leadType],
  );
  const countByStage = new Map(counts.map((c) => [c.current_stage, Number(c.n)]));
  const totalLeads = counts.reduce((sum, c) => sum + Number(c.n), 0);

  // Leads still at-or-beyond each stage, reading sort_order back to front,
  // so conversion is "reached this stage" not "currently sitting on it."
  const atOrBeyond: number[] = new Array(stages.length).fill(0);
  let running = 0;
  for (let i = stages.length - 1; i >= 0; i--) {
    running += countByStage.get(stages[i].name) ?? 0;
    atOrBeyond[i] = running;
  }

  const result: CrmFunnelStage[] = stages.map((s, i) => ({
    stage: s.name,
    sortOrder: s.sort_order,
    count: countByStage.get(s.name) ?? 0,
    conversionFromPrevPct: i === 0 || atOrBeyond[i - 1] === 0 ? null : Number(((atOrBeyond[i] / atOrBeyond[i - 1]) * 100).toFixed(1)),
  }));

  return { leadType, totalLeads, stages: result };
}

export async function getFarmerFunnel(ctx: ToolContext): Promise<ToolResult<CrmFunnelResult>> {
  const policy = await checkCrmPolicy("farmer_funnel", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const result = await funnelStageCounts("farmer");
  await crmAudit(ctx, "farmer_funnel", null, { totalLeads: result.totalLeads });
  return ok(result);
}

export async function getBuyerFunnel(ctx: ToolContext): Promise<ToolResult<CrmFunnelResult>> {
  const policy = await checkCrmPolicy("buyer_funnel", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const result = await funnelStageCounts("credit_buyer");
  await crmAudit(ctx, "buyer_funnel", null, { totalLeads: result.totalLeads });
  return ok(result);
}
