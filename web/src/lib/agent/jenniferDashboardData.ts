import "server-only";

export interface DocumentCentralizationStatus {
  farmsTotal: number;
  farmsLinked: number;
}

/** Real count over mrv.farms — Jennifer's document_centralisation skill, "X of Y farms have a linked Drive folder." */
export async function getDocumentCentralizationStatus(): Promise<DocumentCentralizationStatus> {
  const { query } = await import("../db");
  const rows = await query<{ total: string; linked: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE drive_folder_id IS NOT NULL)::text AS linked
       FROM mrv.farms`,
  );
  return { farmsTotal: Number(rows[0].total), farmsLinked: Number(rows[0].linked) };
}

export interface CrmFollowUp {
  followUpId: string;
  leadId: string;
  leadName: string;
  description: string;
  dueAt: string | null;
}

/** Real, still-open crm.follow_ups rows — Jennifer's add_follow_up tool's own data, read directly (no audit row for a page view). */
export async function listOpenCrmFollowUps(limit = 10): Promise<CrmFollowUp[]> {
  const { crmQuery } = await import("../crmDb");
  const rows = await crmQuery<{
    follow_up_id: string;
    lead_id: string;
    lead_name: string;
    description: string;
    due_at: string | null;
  }>(
    `SELECT f.follow_up_id, f.lead_id, l.full_name AS lead_name, f.description, f.due_at::text
       FROM crm.follow_ups f
       JOIN crm.leads l ON l.lead_id = f.lead_id
      WHERE f.done_at IS NULL
      ORDER BY f.due_at ASC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    followUpId: r.follow_up_id,
    leadId: r.lead_id,
    leadName: r.lead_name,
    description: r.description,
    dueAt: r.due_at,
  }));
}
