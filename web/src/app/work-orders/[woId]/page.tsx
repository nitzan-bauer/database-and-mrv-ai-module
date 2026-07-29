import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkOrder } from "@/lib/data";
import { Card } from "@/components/ui/Card";
import { daysUntil, nextStates, tokenState, DEFAULT_GRACE_DAYS } from "@/lib/mcp/token";

export const dynamic = "force-dynamic";

/**
 * Screen 5 — Work Order (spec §6.5). The printable document: header,
 * assignment, the sampling-points table, the VM0042 §8.2.1.3 field protocol,
 * and the MCP connection block whose token expires 14 days after the
 * (configurable) sampling window.
 */
export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ woId: string }>;
}) {
  const { woId } = await params;
  const wo = await getWorkOrder(decodeURIComponent(woId));
  if (!wo) notFound();

  const st = wo.token ? tokenState(wo.token) : null;
  const left = wo.token ? daysUntil(wo.token.expiresAt) : 0;
  const moves = nextStates(wo.state);

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <Link href="/work-orders" className="hover:text-pine-600">
              Work orders
            </Link>
            <span>/</span>
            <span className="text-muted">{wo.woId}</span>
          </nav>
          <h1 className="mt-1 text-2xl font-bold text-pine-700">Work Order · {wo.woId}</h1>
          <p className="mt-1 text-sm text-muted">
            {wo.farmName} · Cycle {wo.cycleNumber} · {wo.approach} ·{" "}
            <span className="capitalize">{wo.cycleType.replace("_", " ")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/work-orders/${wo.woId}/pdf`}
            className="rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
          >
            Download PDF
          </a>
          {moves.map((m) => (
            <button
              key={m}
              disabled
              title="State transitions write to mrv.work_orders and the audit log — enabled against the live database"
              className="cursor-not-allowed rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted"
            >
              Mark {m.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* document */}
        <div className="space-y-4">
          <Card imprint className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-pine-700">Assignment</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
              <R k="Contractor" v={wo.contractorName ?? "— not assigned —"} />
              <R k="Contact" v={wo.contractorEmail ?? "—"} mono />
              <R k="Sampling window" v={`${wo.windowStart} → ${wo.windowEnd} (configurable)`} />
              <R
                k="Lab destination"
                v={
                  wo.lab
                    ? `${wo.lab.name} · ${[
                        wo.lab.iso17025 && "ISO 17025",
                        wo.lab.glosolanMember && "GLOSOLAN",
                      ]
                        .filter(Boolean)
                        .join(" · ")} · ${wo.lab.defaultMethod?.replace("_", " ")}`
                    : "— not assigned —"
                }
              />
              <R k="Project lead" v={wo.projectLead ?? "—"} />
              <R k="Depth scheme" v={`${wo.depthScheme} cm`} />
              <R
                k="Points"
                v={`${wo.points.length} · ≥5 composites per stratum · ${wo.points[0]?.compositeCores ?? 5} cores each`}
              />
            </dl>
          </Card>

          {/* points table */}
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-pine-700">
                Sampling points · {wo.points.length}
              </h2>
              <p className="font-mono text-[11px] text-faint">
                Sample ID · stratum · scenario · coordinates · depth · cores · re-visit
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-cream">
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                    {["Sample ID", "Str", "Sc", "Lat", "Lon", "Depth", "Cores", "Re-visit"].map((h) => (
                      <th key={h} className="px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wo.points.map((p) => (
                    <tr key={p.pointId} className="border-t border-line">
                      <td className="px-3 py-1.5 font-mono text-[11px]">{p.sampleId}</td>
                      <td className="px-3 py-1.5">{p.stratumCode ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={
                            "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold " +
                            (p.scenario === "BSL"
                              ? "bg-earth-300/40 text-earth-700"
                              : "bg-pine-50 text-pine-700")
                          }
                        >
                          {p.scenario}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums">
                        {p.lat.toFixed(5)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums">
                        {p.lon.toFixed(5)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{p.depthScheme}</td>
                      <td className="px-3 py-1.5 tabular-nums">{p.compositeCores ?? "—"}</td>
                      <td className="px-3 py-1.5">{p.isRevisit ? "yes" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* field protocol */}
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-pine-700">
              Field protocol{" "}
              <span className="font-mono text-[10px] font-normal text-faint">VM0042 §8.2.1.3</span>
            </h2>
            <ol className="ml-4 list-decimal space-y-1 text-[13px] text-muted">
              <li>Clear the surface of litter and residue before coring; do not sample wheel tracks or headlands.</li>
              <li>
                Take {wo.points[0]?.compositeCores ?? 5} cores around the point and composite them
                into one sample per depth increment ({wo.depthScheme} cm).
              </li>
              <li>Sieve to &lt; 2 mm; retain and record coarse fragments — they are needed for the ESM correction.</li>
              <li>Record the actual GPS position and photograph the labelled bag at every point.</li>
              <li>Ship to the laboratory within 5 days of collection; keep samples cool and dry in transit.</li>
            </ol>
          </Card>
        </div>

        {/* MCP block */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl bg-pine-800 p-5 text-white shadow-[var(--shadow-card)]">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sage-300">
              MCP activation
            </p>

            {wo.token ? (
              <>
                <div className="mt-3 rounded-xl bg-white p-3">
                  <QrPlaceholder />
                </div>
                <p className="mt-3 break-all text-center font-mono text-[10.5px] text-pine-100">
                  sampler.carbonature.io/wo/{wo.woId}
                </p>
                <div className="mt-3 space-y-1.5 border-t border-pine-600 pt-3 font-mono text-[11px]">
                  <TokenRow
                    k="Status"
                    v={st === "active" ? `active · ${left} days left` : (st ?? "—")}
                    tone={st === "active" ? "good" : "warn"}
                  />
                  <TokenRow k="Expires" v={wo.token.expiresAt.slice(0, 10)} />
                  <TokenRow k="Window + grace" v={`${DEFAULT_GRACE_DAYS} days`} tone="good" />
                  <TokenRow
                    k="Last used"
                    v={wo.token.lastUsedAt ? wo.token.lastUsedAt.slice(0, 10) : "never"}
                  />
                </div>
                <p className="mt-3 text-[10.5px] leading-snug text-pine-200">
                  Scoped to this work order only. Stored as a hash — the raw token is shown once, at
                  issue. Revocable by the Super Admin or Dave at any time.
                </p>
                <button
                  disabled
                  className="mt-3 w-full cursor-not-allowed rounded-lg border border-pine-600 py-2 text-xs font-semibold text-pine-200"
                >
                  Revoke token
                </button>
              </>
            ) : (
              <div className="mt-3">
                <p className="text-[13px] text-pine-100">
                  No token issued. Sending this work order mints one, scoped to its{" "}
                  {wo.points.length} points and valid until{" "}
                  <b className="text-white">{wo.windowEnd} + {DEFAULT_GRACE_DAYS} days</b>.
                </p>
                <button
                  disabled
                  title="Issuing writes to mrv.mcp_tokens — enabled against the live database"
                  className="mt-3 w-full cursor-not-allowed rounded-lg bg-sage-400/70 py-2.5 text-sm font-semibold text-pine-900"
                >
                  Send &amp; issue token
                </button>
              </div>
            )}
          </div>

          <Card className="p-4">
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
              Lifecycle
            </h3>
            <ol className="mt-2 space-y-1.5">
              {(["draft", "sent", "in_progress", "completed", "closed"] as const).map((s) => {
                const order = ["draft", "sent", "in_progress", "completed", "closed"];
                const done = order.indexOf(s) < order.indexOf(wo.state);
                const now = s === wo.state;
                return (
                  <li key={s} className="flex items-center gap-2 text-[12.5px]">
                    <span
                      className={
                        "inline-block h-2 w-2 rounded-full " +
                        (now ? "bg-pine-600" : done ? "bg-sage-400" : "bg-line-2")
                      }
                    />
                    <span className={now ? "font-semibold text-pine-700" : done ? "text-muted" : "text-faint"}>
                      {s.replace("_", " ")}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 border-t border-line pt-2 font-mono text-[10.5px] text-faint">
              Every transition is written to the audit log with actor, timestamp and target.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function R({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className={"text-ink " + (mono ? "font-mono text-xs" : "")}>{v}</dd>
    </>
  );
}

function TokenRow({ k, v, tone }: { k: string; v: string; tone?: "good" | "warn" }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-pine-300">{k}</span>
      <span
        className={
          tone === "good" ? "font-semibold text-sage-300" : tone === "warn" ? "text-gold-300" : "text-white"
        }
      >
        {v}
      </span>
    </div>
  );
}

/** A stand-in QR block — the real code is rendered into the PDF at issue. */
function QrPlaceholder() {
  const cells = [
    [1, 1, 1, 0, 1, 0, 1, 1, 1],
    [1, 0, 1, 0, 1, 1, 1, 0, 1],
    [1, 1, 1, 0, 0, 1, 1, 1, 1],
    [0, 0, 0, 1, 1, 0, 0, 0, 0],
    [1, 1, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 1, 0, 1, 1, 0, 1, 1],
    [1, 1, 1, 0, 1, 0, 1, 1, 0],
    [1, 0, 1, 1, 0, 1, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 0, 1, 1],
  ];
  return (
    <svg viewBox="0 0 9 9" className="mx-auto block h-28 w-28" aria-label="MCP activation code">
      {cells.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1f4140" /> : null,
        ),
      )}
    </svg>
  );
}
