import { funnelStageCounts, type CrmFunnelResult } from "@/lib/tools/getCrmFunnel";
import { computeCrmHygieneIssues } from "@/lib/tools/checkCrmHygiene";
import { listRecentCrmLeads } from "@/lib/agent/crmDashboardData";

/**
 * Section 1 for Ron's own page — real crm.leads data, read directly off
 * the same RDS instance the MRV module itself connects to (no HTTP hop,
 * no separate app to query): Funnel A (farmer acquisition) and Funnel B
 * (credit-buyer acquisition), a hygiene pass Jennifer's tool already
 * computes, and the most recent leads. This is the concrete "deepen what
 * already connects" piece of the MRV<->CRM<->SaaS integration — the data
 * link already existed (Ron's own record_lead/farmer_funnel/buyer_funnel
 * tools), it just had no dashboard reading it back.
 */
export async function RonDashboard() {
  const [farmerFunnel, buyerFunnel, hygiene, recentLeads] = await Promise.all([
    funnelStageCounts("farmer"),
    funnelStageCounts("credit_buyer"),
    computeCrmHygieneIssues(),
    listRecentCrmLeads(8),
  ]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-pine-700">Ron&apos;s dashboard — CRM pipeline</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">
          Real rows from <span className="font-mono text-[12px]">crm.leads</span> — the same Postgres
          instance the MRV module itself connects to. No API hop, no second copy of the data.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FunnelCard title="Funnel A — Farmer acquisition" funnel={farmerFunnel} />
        <FunnelCard title="Funnel B — Credit-buyer acquisition" funnel={buyerFunnel} />
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-1 text-[13px] font-bold text-pine-700">CRM hygiene</h3>
        <p className="mb-3 text-[11.5px] text-faint">
          Flags only — never merges or deletes a lead. Jennifer&apos;s own crm_hygiene check.
        </p>
        {hygiene.issues.length === 0 ? (
          <p className="text-[12.5px] text-sage-700">
            No issues found across {hygiene.leadsChecked} lead{hygiene.leadsChecked === 1 ? "" : "s"}.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {hygiene.issues.map((issue, i) => (
              <div
                key={`${issue.leadId}-${issue.code}-${i}`}
                className={"flex items-baseline gap-3 px-3 py-2 text-[12px] " + (i > 0 ? "border-t border-line" : "")}
              >
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                    (issue.code === "STALE"
                      ? "bg-gold-200 text-earth-600"
                      : issue.code === "DUPLICATE_EMAIL"
                        ? "bg-verify-100 text-verify-700"
                        : "bg-cream text-muted")
                  }
                >
                  {issue.code}
                </span>
                <span className="shrink-0 font-semibold text-pine-700">{issue.fullName}</span>
                <span className="truncate text-faint">{issue.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-3 text-[13px] font-bold text-pine-700">Recent leads</h3>
        {recentLeads.length === 0 ? (
          <p className="text-[12.5px] text-faint">No leads recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {recentLeads.map((lead, i) => (
              <div
                key={lead.leadId}
                className={"flex items-center gap-3 px-3 py-2 text-[12px] " + (i > 0 ? "border-t border-line" : "")}
              >
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                    (lead.leadType === "farmer" ? "bg-sage-100 text-sage-700" : "bg-agent-100 text-agent-700")
                  }
                >
                  {lead.leadType}
                </span>
                <span className="w-36 shrink-0 truncate font-semibold text-pine-700">{lead.fullName}</span>
                <span className="w-40 shrink-0 truncate text-faint">{lead.currentStage}</span>
                <span className="truncate text-faint">{lead.email ?? "—"}</span>
                {lead.farmId && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-sage-700">linked farm</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FunnelCard({ title, funnel }: { title: string; funnel: CrmFunnelResult }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-pine-700">{title}</h3>
        <span className="font-mono text-[11px] text-faint">{funnel.totalLeads} total</span>
      </div>
      {funnel.stages.length === 0 ? (
        <p className="text-[12px] text-faint">No pipeline stages configured.</p>
      ) : (
        <div className="space-y-2">
          {funnel.stages.map((s) => {
            const widthPct = funnel.totalLeads ? Math.max(4, Math.round((s.count / funnel.totalLeads) * 100)) : 0;
            return (
              <div key={s.stage}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink">{s.stage}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    {s.count}
                    {s.conversionFromPrevPct !== null && ` · ${s.conversionFromPrevPct}% conv.`}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-cream">
                  <div className="h-full bg-sage-400" style={{ width: `${widthPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
