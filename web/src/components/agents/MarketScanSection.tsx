import type { MarketScanDeal, MarketScanProject } from "@/lib/agent/marketScan";

/**
 * source_url on every row here is LLM-parsed out of real web-search
 * results (John's monthly scans), not a value this codebase ever writes
 * itself — nothing has validated it's an actual http(s) link before it
 * reaches this component. Rendering an arbitrary string straight into
 * href lets a poisoned search result (or a page crafted to be scraped)
 * carry a `javascript:` URI that runs when a user clicks the "source"
 * link. Only allow the two safe schemes through; anything else, this
 * renders as inert plain text instead of a link.
 */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * John's department dashboard (Nitzan's own spec, attached prompt): who
 * else has issued VM0042 or regenerative-ag credits, and what they're
 * trading for. Both lists are exactly what john_monthly_vm0042_project_scan
 * and john_monthly_credit_market_scan (0080) have actually found by real
 * web search — empty until the first scan runs, never filled with a
 * plausible-looking placeholder.
 */
export function MarketScanSection({
  projects,
  deals,
}: {
  projects: MarketScanProject[];
  deals: MarketScanDeal[];
}) {
  return (
    <section>
      <h2 className="mb-1 text-base font-bold text-pine-700">Market intelligence — John</h2>
      <p className="mb-3 max-w-3xl text-[13px] text-muted">
        VM0042 (any registry) and non-Verra regenerative-agriculture projects that have issued
        credits, and recent deals/prices for both — every row a real web-search find with its own
        source link, refreshed monthly.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
            Projects issuing credits ({projects.length})
          </h3>
          {projects.length === 0 ? (
            <EmptyCard text="No scan has run yet — this fills in once John's monthly project scan runs." />
          ) : (
            <div className="space-y-1.5">
              {projects.map((p) => {
                const href = safeHref(p.sourceUrl);
                const Card = href ? "a" : "div";
                return (
                  <Card
                    key={`${p.registry}-${p.projectName}`}
                    {...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="block rounded-lg border border-line bg-white px-3 py-2 transition-colors hover:border-pine-300 hover:bg-pine-50/40"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] font-bold text-pine-700">
                        {p.issuerName ?? p.registry}
                        {p.location && <span className="font-normal text-faint"> — {p.location}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-faint">
                        {p.registry}
                        {p.methodology ? ` · ${p.methodology}` : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted">{p.projectName}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-ink">{p.creditsIssuedNote}</p>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
            Category market tracker ({deals.length})
          </h3>
          {deals.length === 0 ? (
            <EmptyCard text="No scan has run yet — this fills in once John's monthly market scan runs." />
          ) : (
            <div className="space-y-2">
              {deals.map((d) => {
                const href = safeHref(d.sourceUrl);
                return (
                  <details
                    key={`${d.registry}-${d.projectOrSeller}-${d.priceNote}`}
                    className="group overflow-hidden rounded-xl border border-line bg-white open:shadow-card"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0 truncate text-[12.5px] font-semibold text-pine-700">
                        {d.projectOrSeller}
                      </span>
                      <span className="shrink-0 font-mono text-[11.5px] font-bold text-gold-600">{d.priceNote}</span>
                    </summary>
                    <div className="border-t border-line px-3 py-2.5">
                      <p className="text-[11.5px] text-ink">{d.brief}</p>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-block text-[11px] font-semibold text-verify-700 hover:underline"
                        >
                          {d.registry}
                          {d.methodology ? ` · ${d.methodology}` : ""} — source ↗
                        </a>
                      ) : (
                        <span className="mt-1.5 inline-block text-[11px] font-semibold text-faint">
                          {d.registry}
                          {d.methodology ? ` · ${d.methodology}` : ""} (no valid source link)
                        </span>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-[12.5px] text-muted">{text}</p>
    </div>
  );
}
