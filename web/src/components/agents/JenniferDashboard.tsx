import { computeCrmHygieneIssues } from "@/lib/tools/checkCrmHygiene";
import { getDocumentCentralizationStatus, listOpenCrmFollowUps } from "@/lib/agent/jenniferDashboardData";

/**
 * Section 1 for Jennifer's own page — her three real skills
 * (document_centralisation, crm_hygiene, scheduling), each backed by a
 * real read: how many farms actually have a linked Drive folder, her own
 * crm_hygiene tool's real flags (same computation Ron's page reads, just
 * given its proper home — this is her tool, not his), and her own open
 * crm.follow_ups.
 */
export async function JenniferDashboard() {
  const [docStatus, hygiene, followUps] = await Promise.all([
    getDocumentCentralizationStatus(),
    computeCrmHygieneIssues(),
    listOpenCrmFollowUps(10),
  ]);

  const docPct = docStatus.farmsTotal ? Math.round((docStatus.farmsLinked / docStatus.farmsTotal) * 100) : 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-pine-700">Jennifer&apos;s dashboard</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">
          &ldquo;Keep the department running smoothly — accurate intake, organised records, reliable
          scheduling, clean data.&rdquo; Three real reads, one per skill.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-bold text-pine-700">Document centralisation</h3>
          <span className="font-mono text-[11px] text-faint">
            {docStatus.farmsLinked}/{docStatus.farmsTotal} farms
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-cream">
          <div className="h-full bg-sage-400" style={{ width: `${docPct}%` }} />
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          Farms with a Drive folder linked (<span className="font-mono text-[10.5px]">mrv.farms.drive_folder_id</span>) —
          the rest have no centralised place for their documents yet.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-1 text-[13px] font-bold text-pine-700">CRM hygiene</h3>
        <p className="mb-3 text-[11.5px] text-faint">Her own crm_hygiene check — flags only, never merges or deletes.</p>
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
        <h3 className="mb-3 text-[13px] font-bold text-pine-700">Open follow-ups</h3>
        {followUps.length === 0 ? (
          <p className="text-[12.5px] text-faint">Nothing open right now.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {followUps.map((f, i) => (
              <div
                key={f.followUpId}
                className={"flex items-center gap-3 px-3 py-2 text-[12px] " + (i > 0 ? "border-t border-line" : "")}
              >
                <span className="w-36 shrink-0 truncate font-semibold text-pine-700">{f.leadName}</span>
                <span className="truncate text-ink">{f.description}</span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">
                  {f.dueAt ? new Date(f.dueAt).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "no due date"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
