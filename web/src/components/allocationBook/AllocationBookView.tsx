import type { AllocationBookView as ViewData } from "@/lib/agent/scheduledTasks/allocationBook/liveView";
import { BookTable } from "./BookTable";
import { ReconciledBadge } from "./ReconciledBadge";

const TOC = [
  { id: "chapter-1", num: "1", label: "Buyer Transactions Ledger" },
  { id: "chapter-2", num: "2", label: "Potential Credit Allocation" },
  { id: "chapter-3", num: "3", label: "Actual Credit Allocation" },
  { id: "protections", num: "", label: "Protection Status" },
];

/**
 * The live "Book" page — Option B's other half (the weekly PDF Snapshot
 * is the archival record; this is the always-current source of truth),
 * per the approved spec (agent-memory project_mrv_allocation_book_spec).
 * Built to match the spec's own mockups visually, not just structurally:
 * same CarboNature palette the docx mockups used (pine/sage/gold, already
 * the app's own design tokens — see globals.css), real "Split" two-line
 * headers, an actual colored RECONCILED badge instead of a truncated PDF
 * table row, and Chapter 3 always rendered (never hidden) even when it
 * has no data yet — its own empty state is real content, not an omission.
 */
export function AllocationBookView({ view }: { view: ViewData }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 border-b border-line-2 pb-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-sage-500">CarboNature · Allocation Book</p>
        <h1 className="mt-1 text-[28px] font-semibold text-pine-800">Allocation Book</h1>
        <p className="mt-1 text-[13px] text-muted">
          Live — generated {new Date(view.generatedAt).toLocaleString("en-GB")}. The weekly PDF Snapshot remains the archival record; this page is always current.
        </p>
      </header>

      <nav className="mb-10 flex flex-wrap gap-2 rounded-md border border-line-2 bg-cream p-3 text-[13px]">
        {TOC.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="rounded px-2.5 py-1 text-pine-700 hover:bg-sage-100">
            {t.num ? `${t.num}. ` : ""}
            {t.label}
          </a>
        ))}
      </nav>

      {view.negativeBalance.active.length > 0 ? (
        <section id="protections" className="mb-10 rounded-md border border-danger/40 bg-danger/5 p-4">
          <h2 className="mb-2 text-[15px] font-semibold text-danger">Active Negative-Balance Alerts (Section 7.3)</h2>
          <ul className="space-y-1 text-[13px] text-ink">
            {view.negativeBalance.active.map((a, i) => (
              <li key={i}>
                <span className="font-semibold">{a.label}</span> — balance {a.balancePctAtTrigger.toFixed(1)}% at trigger (≤{a.thresholdPct}%
                threshold).{" "}
                {a.blocksAgriInputs || a.blocksProjectFunding ? (
                  <span className="font-semibold text-danger">
                    BLOCKED: {[a.blocksAgriInputs && "Agri Inputs", a.blocksProjectFunding && "Project Funding"].filter(Boolean).join(" + ")}
                  </span>
                ) : (
                  "Alert only — no deals blocked."
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section id="protections" className="mb-10 rounded-md border border-ok/30 bg-ok/5 p-4 text-[13px] text-ok">
          Section 7.3 — no active negative-balance alerts. All farms and projects are above the 30% threshold.
        </section>
      )}

      <section id="chapter-1" className="mb-12 scroll-mt-6">
        <h2 className="mb-1 text-[20px] font-semibold text-pine-800">1. Chapter 1 — Buyer Transactions Ledger</h2>
        <p className="mb-4 text-[13px] text-muted">
          {view.chapter1Grand.credits.toLocaleString("en-US")} VCU across all deals, worth ${view.chapter1Grand.value.toLocaleString("en-US")}.
        </p>
        <BookTable table={view.chapter1} />
      </section>

      <section id="chapter-2" className="mb-12 scroll-mt-6">
        <h2 className="mb-1 text-[20px] font-semibold text-pine-800">2. Chapter 2 — Potential Credit Allocation</h2>
        <p className="mb-4 text-[13px] text-muted">Sub-chapters 5.1–5.3: Net Allocation to Farms, Net Allocation to CarboNature, and the reconciliation gate.</p>
        <h3 className="mb-2 text-[15px] font-semibold text-pine-800">5.1 — Net Allocation to Farms</h3>
        <BookTable table={view.chapter2.farms} />
        <h3 className="mb-2 text-[15px] font-semibold text-pine-800">5.2 — Net Allocation to CarboNature</h3>
        <BookTable table={view.chapter2.carboNature} />
        <h3 className="mb-2 flex items-center gap-3 text-[15px] font-semibold text-pine-800">
          5.3 — Total Credit in Value
          <ReconciledBadge reconciled={view.chapter2.reconciled} discrepancy={view.chapter2.discrepancy} />
        </h3>
        <BookTable table={view.chapter2.reconciliation} />
      </section>

      <section id="chapter-3" className="mb-12 scroll-mt-6">
        <h2 className="mb-1 text-[20px] font-semibold text-pine-800">3. Chapter 3 — Actual Credit Allocation</h2>
        {view.chapter3.hasAnyRound ? (
          view.chapter3.tables.map((t, i) => <BookTable key={i} table={t} />)
        ) : (
          <div className="rounded-md border border-line-2 bg-cream p-6 text-center text-[13px] text-muted">
            <p className="font-semibold text-pine-700">No completed issuance round yet</p>
            <p className="mt-1">
              This chapter — including 6.3 Actual vs Plan — will populate automatically the first time a real issuance is recorded
              (mrv.vcu_issuances → mrv.allocation_rounds). No figures are fabricated here.
            </p>
          </div>
        )}
      </section>

      <footer className="border-t border-line-2 pt-4 text-[11px] text-faint">CarboNature MRV — Allocation Book, live view.</footer>
    </div>
  );
}
