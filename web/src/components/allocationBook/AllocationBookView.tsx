import type { AllocationBookView as ViewData } from "@/lib/agent/scheduledTasks/allocationBook/liveView";
import { BookTable } from "./BookTable";
import { Chapter1Ledger } from "./Chapter1Ledger";
import { ReconciledBadge } from "./ReconciledBadge";

/** A real vertical table of contents — chapters and sub-chapters, sequential numbering — per Nitzan's explicit request (2026-08-31): "build a Table of Contents like a table of contents." */
const TOC: { id: string; num: string; label: string; sub?: boolean }[] = [
  { id: "protections", num: "", label: "Protection Status" },
  { id: "chapter-1", num: "1", label: "Buyer Transactions Ledger" },
  { id: "chapter-2", num: "2", label: "Potential Credit Allocation" },
  { id: "chapter-2-1", num: "2.1", label: "Net Allocation to Farms", sub: true },
  { id: "chapter-2-2", num: "2.2", label: "Net Allocation to CarboNature", sub: true },
  { id: "chapter-2-3", num: "2.3", label: "Total Credit in Value", sub: true },
  { id: "chapter-3", num: "3", label: "Actual Credit Allocation" },
  { id: "chapter-3-1", num: "3.1", label: "Net Allocation to Farms (Actual)", sub: true },
  { id: "chapter-3-2", num: "3.2", label: "Net Allocation to CarboNature (Actual)", sub: true },
  { id: "chapter-3-3", num: "3.3", label: "Total Credit in Value (Actual)", sub: true },
  { id: "chapter-3-4", num: "3.4", label: "Actual vs Plan", sub: true },
];

/**
 * The live "Book" page — Option B's other half (the weekly PDF Snapshot
 * is the archival record; this is the always-current source of truth),
 * per the approved spec (agent-memory project_mrv_allocation_book_spec).
 * Built to match the spec's own mockups visually, not just structurally:
 * same CarboNature palette the docx mockups used (pine/sage/gold, already
 * the app's own design tokens — see globals.css), real "Split" two-line
 * headers, an actual colored RECONCILED badge instead of a truncated PDF
 * table row, and Chapter 3 always rendered as real (empty) tables rather
 * than a text-only placeholder — its own empty state is real content,
 * not an omission (Nitzan, 2026-08-31).
 */
export function AllocationBookView({ view }: { view: ViewData }) {
  // The empty-state shape (see liveView.ts's buildEmptyChapter3Tables) is
  // always exactly [round header, 3.1, 3.2, 3.3, 3.4] — fixed, so it can
  // get real anchor ids matching the TOC above. Once a real round exists,
  // chapter3.ts emits one combined table per round instead (a genuinely
  // different shape) plus at most one trailing Actual-vs-Plan table — that
  // case renders generically rather than assuming a fixed position.
  const [roundHeader, c3Farms, c3CarboNature, c3Reconciliation, c3ActualVsPlan] = !view.chapter3.hasAnyRound ? view.chapter3.tables : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 border-b border-line-2 pb-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-sage-500">CarboNature · Allocation Book</p>
        <h1 className="mt-1 text-[28px] font-semibold text-pine-800">Allocation Book</h1>
        <p className="mt-1 text-[13px] text-muted">
          Live — generated {new Date(view.generatedAt).toLocaleString("en-GB")}. The weekly PDF Snapshot remains the archival record; this page is always current.
        </p>
      </header>

      <nav className="mb-10 rounded-md border border-line-2 bg-cream p-4 text-[13px]">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-sage-500">Table of Contents</p>
        <ol className="space-y-1">
          {TOC.map((t) => (
            <li key={t.id} className={t.sub ? "ml-6" : ""}>
              <a href={`#${t.id}`} className={`flex gap-2 rounded px-2 py-1 text-pine-700 hover:bg-sage-100 ${t.sub ? "" : "font-semibold"}`}>
                {t.num ? <span className="w-8 shrink-0 font-mono text-sage-600">{t.num}</span> : <span className="w-8 shrink-0" />}
                {t.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {view.negativeBalance.active.length > 0 ? (
        <section id="protections" className="mb-10 scroll-mt-6 rounded-md border border-danger/40 bg-danger/5 p-4">
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
        <section id="protections" className="mb-10 scroll-mt-6 rounded-md border border-ok/30 bg-ok/5 p-4 text-[13px] text-ok">
          Section 7.3 — no active negative-balance alerts. All farms and projects are above the 30% threshold.
        </section>
      )}

      <section id="chapter-1" className="mb-12 scroll-mt-6">
        <h2 className="mb-1 text-[20px] font-semibold text-pine-800">1. Buyer Transactions Ledger</h2>
        <p className="mb-4 text-[13px] text-muted">
          {view.chapter1Grand.credits.toLocaleString("en-US")} VCU across all deals, worth ${view.chapter1Grand.value.toLocaleString("en-US")}.
        </p>
        <Chapter1Ledger table={view.chapter1} contracts={view.chapter1Contracts} />
      </section>

      <section id="chapter-2" className="mb-12 scroll-mt-6">
        <h2 className="mb-4 text-[20px] font-semibold text-pine-800">2. Potential Credit Allocation</h2>
        <div id="chapter-2-1" className="scroll-mt-6">
          <BookTable table={view.chapter2.farms} />
        </div>
        <div id="chapter-2-2" className="scroll-mt-6">
          <BookTable table={view.chapter2.carboNature} />
        </div>
        <div id="chapter-2-3" className="scroll-mt-6">
          <BookTable table={view.chapter2.reconciliation} titleExtra={<ReconciledBadge reconciled={view.chapter2.reconciled} discrepancy={view.chapter2.discrepancy} />} />
        </div>
      </section>

      <section id="chapter-3" className="mb-12 scroll-mt-6">
        <h2 className="mb-1 text-[20px] font-semibold text-pine-800">3. Actual Credit Allocation</h2>
        {!view.chapter3.hasAnyRound ? (
          <p className="mb-4 text-[13px] text-muted">
            No completed issuance round exists yet — the tables below show the real structure, empty, and will populate automatically the first
            time a real round is recorded. No figures are fabricated.
          </p>
        ) : null}
        {!view.chapter3.hasAnyRound ? (
          <>
            {roundHeader ? <BookTable table={roundHeader} /> : null}
            {c3Farms ? (
              <div id="chapter-3-1" className="scroll-mt-6">
                <BookTable table={c3Farms} />
              </div>
            ) : null}
            {c3CarboNature ? (
              <div id="chapter-3-2" className="scroll-mt-6">
                <BookTable table={c3CarboNature} />
              </div>
            ) : null}
            {c3Reconciliation ? (
              <div id="chapter-3-3" className="scroll-mt-6">
                <BookTable table={c3Reconciliation} />
              </div>
            ) : null}
            {c3ActualVsPlan ? (
              <div id="chapter-3-4" className="scroll-mt-6">
                <BookTable table={c3ActualVsPlan} />
              </div>
            ) : null}
          </>
        ) : (
          view.chapter3.tables.map((t, i) => (
            <div key={i} id={`chapter-3-${i + 1}`} className="scroll-mt-6">
              <BookTable table={t} />
            </div>
          ))
        )}
      </section>

      <footer className="border-t border-line-2 pt-4 text-[11px] text-faint">CarboNature MRV — Allocation Book, live view.</footer>
    </div>
  );
}
