import "server-only";

export interface RecentCrmLead {
  leadId: string;
  fullName: string;
  leadType: "farmer" | "credit_buyer";
  currentStage: string;
  email: string | null;
  farmId: string | null;
  createdAt: string;
}

/**
 * Real, recent crm.leads rows for Ron's own dashboard — a passive read
 * (no policy check, no audit row), same "display vs. audited action"
 * split as funnelStageCounts/computeCrmHygieneIssues.
 */
export async function listRecentCrmLeads(limit = 10): Promise<RecentCrmLead[]> {
  const { crmQuery } = await import("../crmDb");
  const rows = await crmQuery<{
    lead_id: string;
    full_name: string;
    lead_type: string;
    current_stage: string;
    email: string | null;
    farm_id: string | null;
    created_at: string;
  }>(
    `SELECT lead_id, full_name, lead_type, current_stage, email, farm_id, created_at::text
       FROM crm.leads
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    leadId: r.lead_id,
    fullName: r.full_name,
    leadType: r.lead_type as "farmer" | "credit_buyer",
    currentStage: r.current_stage,
    email: r.email,
    farmId: r.farm_id,
    createdAt: r.created_at,
  }));
}
