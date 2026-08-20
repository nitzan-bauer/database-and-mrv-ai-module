import "server-only";
import { checkCrmPolicy, crmAudit, ok, fail, type ToolContext, type ToolResult } from "./crmContext";

export interface CrmHygieneIssue {
  leadId: string;
  fullName: string;
  code: "DUPLICATE_EMAIL" | "STALE" | "INCOMPLETE";
  detail: string;
}

export interface CrmHygieneResult {
  leadsChecked: number;
  issues: CrmHygieneIssue[];
}

/**
 * Jennifer's crm_hygiene tool (spec §3) — keeps CRM records clean by
 * flagging problems for a human to act on, never merging or deleting
 * anything itself. Three checks, mirroring the deduplicate/flag-stale/
 * flag-incomplete description in the original spec:
 *
 *   - DUPLICATE_EMAIL: two or more leads share the same email address
 *     (case-insensitive) — almost always the same contact recorded twice,
 *     e.g. from a typo'd domain on one of the entries.
 *   - STALE: no stage change in staleDays (default 14), and the lead
 *     hasn't already reached the last stage of its pipeline — a lead
 *     that's already closed out isn't "stale," it's just done.
 *   - INCOMPLETE: no email and no phone recorded — there is no way to
 *     actually reach this contact.
 */
export async function checkCrmHygiene(
  ctx: ToolContext,
  input: { staleDays?: number } = {},
): Promise<ToolResult<CrmHygieneResult>> {
  const policy = await checkCrmPolicy("crm_hygiene", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const staleDays = input.staleDays ?? 14;
  if (!(staleDays > 0)) return fail("checkCrmHygiene: staleDays must be a positive number.");

  const { crmQuery } = await import("../crmDb");

  const leads = await crmQuery<{
    lead_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    lead_type: string;
    current_stage: string;
    updated_at: string;
  }>(
    `SELECT lead_id, full_name, email, phone, lead_type, current_stage, updated_at::text AS updated_at
       FROM crm.leads`,
  );
  if (!leads.length) return ok({ leadsChecked: 0, issues: [] });

  const lastStageByType = new Map<string, string>();
  const stageRows = await crmQuery<{ lead_type: string; name: string }>(
    `SELECT DISTINCT ON (lead_type) lead_type, name
       FROM crm.pipeline_stages ORDER BY lead_type, sort_order DESC`,
  );
  for (const s of stageRows) lastStageByType.set(s.lead_type, s.name);

  const issues: CrmHygieneIssue[] = [];

  const byEmail = new Map<string, { leadId: string; fullName: string }[]>();
  for (const l of leads) {
    if (!l.email) continue;
    const key = l.email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push({ leadId: l.lead_id, fullName: l.full_name });
  }
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    for (const g of group) {
      const others = group.filter((o) => o.leadId !== g.leadId).map((o) => `${o.fullName} (${o.leadId})`);
      issues.push({
        leadId: g.leadId,
        fullName: g.fullName,
        code: "DUPLICATE_EMAIL",
        detail: `shares ${email} with ${others.join(", ")}`,
      });
    }
  }

  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  for (const l of leads) {
    const isLastStage = lastStageByType.get(l.lead_type) === l.current_stage;
    if (isLastStage) continue;
    const updatedAt = new Date(l.updated_at).getTime();
    if (updatedAt < staleCutoff) {
      const days = Math.floor((Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
      issues.push({
        leadId: l.lead_id,
        fullName: l.full_name,
        code: "STALE",
        detail: `no stage change in ${days} day(s) — still at "${l.current_stage}"`,
      });
    }
  }

  for (const l of leads) {
    if (!l.email && !l.phone) {
      issues.push({
        leadId: l.lead_id,
        fullName: l.full_name,
        code: "INCOMPLETE",
        detail: "no email and no phone recorded — this contact cannot currently be reached",
      });
    }
  }

  await crmAudit(ctx, "crm_hygiene", null, {
    leadsChecked: leads.length,
    staleDays,
    issuesFound: issues.length,
    issues: issues.map((i) => ({ leadId: i.leadId, code: i.code })),
  });

  return ok({ leadsChecked: leads.length, issues });
}
