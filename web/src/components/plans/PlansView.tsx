"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import type { SamplingPlan } from "@/lib/data/types";
import type { GeneratedPlan } from "@/lib/planner/generate";

type Advice = { headline: string; reasons: string[] };
type Details = Record<string, { plan: GeneratedPlan; advice: Advice }>;

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-cream text-muted",
  approved: "bg-sage-100 text-sage-700",
  in_field: "bg-verify-100 text-verify-700",
  lab_pending: "bg-gold-200 text-earth-600",
  complete: "bg-sage-100 text-sage-700",
  cancelled: "bg-cream text-faint",
};

const TYPE_LABEL: Record<string, string> = {
  initial: "Initial",
  true_up: "True-up",
  verification: "Verification",
};

/** Bar colour by cycle type — initial is the anchor, later cycles lighter. */
const TYPE_BAR: Record<string, string> = {
  initial: "bg-pine-600",
  true_up: "bg-verify-500",
  verification: "bg-agent-500",
};

export function PlansView({
  plans,
  farms,
  details,
  initialFarm = "all",
  initialPlan = null,
}: {
  plans: SamplingPlan[];
  farms: Array<{ farmId: string; name: string }>;
  details: Details;
  /** ?farm= — preselect the farm filter */
  initialFarm?: string;
  /** ?plan= — open a plan's detail on load, so a plan is shareable by link */
  initialPlan?: string | null;
}) {
  const [farmFilter, setFarmFilter] = useState<string>(initialFarm);
  const [openId, setOpenId] = useState<string | null>(initialPlan);

  const shown = useMemo(
    () => (farmFilter === "all" ? plans : plans.filter((p) => p.farmId === farmFilter)),
    [plans, farmFilter],
  );

  /* three-year window, anchored on the earliest planned start */
  const { years, spanStart, spanMs } = useMemo(() => {
    const starts = plans.map((p) => (p.plannedStart ? Date.parse(p.plannedStart) : NaN)).filter(Number.isFinite);
    const y0 = starts.length ? new Date(Math.min(...starts)).getUTCFullYear() : new Date().getUTCFullYear();
    const ys = [y0, y0 + 1, y0 + 2];
    const start = Date.UTC(y0, 0, 1);
    return { years: ys, spanStart: start, spanMs: Date.UTC(y0 + 3, 0, 1) - start };
  }, [plans]);

  const pct = (iso: string | null) =>
    iso ? ((Date.parse(iso) - spanStart) / spanMs) * 100 : 0;

  const byFarm = useMemo(() => {
    const m = new Map<string, SamplingPlan[]>();
    for (const p of shown) m.set(p.farmId, [...(m.get(p.farmId) ?? []), p]);
    return [...m.entries()];
  }, [shown]);

  const open = openId ? plans.find((p) => p.cycleId === openId) : null;
  const openDetail = openId ? details[openId] : null;

  return (
    <div className="space-y-4">
      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
          Farm
        </span>
        {[{ farmId: "all", name: "All farms" }, ...farms].map((f) => (
          <button
            key={f.farmId}
            onClick={() => setFarmFilter(f.farmId)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (farmFilter === f.farmId
                ? "bg-pine-600 text-white"
                : "border border-line bg-white text-pine-700 hover:bg-pine-50")
            }
          >
            {f.name}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-faint">
          {shown.length} plans · {years[0]}–{years[2]}
        </span>
      </div>

      {/* 3-year timeline */}
      <Card className="p-5">
        <div className="mb-2 grid grid-cols-3 border-b border-line pb-1.5">
          {years.map((y) => (
            <span key={y} className="font-mono text-[11px] font-semibold text-muted">
              {y}
            </span>
          ))}
        </div>

        <div className="space-y-4">
          {byFarm.map(([farmId, rows]) => (
            <div key={farmId}>
              <p className="mb-1.5 text-sm font-semibold text-pine-700">{rows[0].farmName}</p>
              <div className="relative h-9 rounded-lg bg-cream">
                {/* year gridlines */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3">
                  <div className="border-r border-line" />
                  <div className="border-r border-line" />
                  <div />
                </div>
                {rows.map((p) => {
                  const left = pct(p.plannedStart);
                  return (
                    <button
                      key={p.cycleId}
                      onClick={() => setOpenId(p.cycleId)}
                      title={`${TYPE_LABEL[p.cycleType]} · ${p.plannedStart} → ${p.plannedEnd}`}
                      style={{ left: `${Math.max(0, Math.min(92, left))}%` }}
                      className={
                        "absolute top-1.5 flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[10.5px] font-semibold text-white shadow transition-transform hover:scale-105 " +
                        (TYPE_BAR[p.cycleType] ?? "bg-pine-600")
                      }
                    >
                      C{p.cycleNumber} · {TYPE_LABEL[p.cycleType]}
                      <span className="font-mono opacity-80">{p.plannedPoints}pt</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-line pt-2.5 font-mono text-[11px] text-faint">
          Cycle intervals follow the crop, not the calendar — up to 10 months, and a short-growth crop
          can trigger a further round in under a year.
        </p>
      </Card>

      {/* plan table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                {["Cycle", "Farm", "Type", "Window", "Points", "Trigger", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.cycleId} className="border-t border-line">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.cycleId}</td>
                  <td className="px-4 py-2.5">{p.farmName}</td>
                  <td className="px-4 py-2.5">{TYPE_LABEL[p.cycleType]}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">
                    {p.plannedStart} → {p.plannedEnd}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-pine-700 tabular-nums">
                    {p.plannedPoints}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{p.triggerType ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                        (STATUS_STYLE[p.status] ?? "bg-cream text-muted")
                      }
                    >
                      {p.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setOpenId(p.cycleId)}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-pine-700 hover:bg-pine-50"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {open && openDetail && (
        <PlanDrawer plan={open} detail={openDetail} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

/* ───────────────────────── plan detail drawer ───────────────────────── */

function PlanDrawer({
  plan,
  detail,
  onClose,
}: {
  plan: SamplingPlan;
  detail: { plan: GeneratedPlan; advice: Advice };
  onClose: () => void;
}) {
  const { plan: gen, advice } = detail;
  const allPass = gen.checks.every((c) => c.passed);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-pine-900/30 backdrop-blur-sm">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-line bg-white/95 px-6 py-4 backdrop-blur">
          <div>
            <p className="font-mono text-[11px] text-faint">{plan.cycleId}</p>
            <h2 className="text-lg font-bold text-pine-700">
              {plan.farmName} · Cycle {plan.cycleNumber} · {TYPE_LABEL[plan.cycleType]}
            </h2>
            <p className="text-xs text-muted">
              {plan.plannedStart} → {plan.plannedEnd} · {plan.triggerType}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-cream"
          >
            Close
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* parameters */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-pine-700">Plan configuration</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
              <P k="Approach" v={plan.approach} />
              <P k="Depth scheme" v={`${plan.depthScheme} cm`} />
              <P k="Confidence α / power" v={`${plan.confidenceAlpha} / ${plan.power}`} />
              <P k="MDD target" v={`${plan.mddTarget} t SOC/ha`} />
              <P k="Cores per composite" v={String(gen.coresPerComposite)} />
              <P k="Same-season window" v={plan.sameSeason ? "yes" : "no"} />
              <P k="Revisit points" v={plan.revisitPoints ? "yes" : "no"} />
              <P
                k="First-round texture"
                v={plan.collectTexture ? `every point · ${plan.textureDepthCm} cm` : "not required"}
                highlight={plan.collectTexture}
              />
            </dl>
          </section>

          {/* per-stratum allocation */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-pine-700">
              Per-stratum allocation · {gen.totalPoints} points
            </h3>
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 font-semibold">Plot · stratum</th>
                    <th className="px-3 py-2 font-semibold">Area</th>
                    <th className="px-3 py-2 font-semibold">CV</th>
                    <th className="px-3 py-2 font-semibold">Points</th>
                    <th className="px-3 py-2 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {gen.strata.map((s) => (
                    <tr key={`${s.plotId}-${s.code}`} className="border-t border-line">
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {s.plotId} · {s.code}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{s.areaHa.toFixed(1)} ha</td>
                      <td className="px-3 py-2 tabular-nums">
                        {s.cv == null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={s.cv > 0.3 ? "font-semibold text-gold-600" : ""}>
                            {(s.cv * 100).toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-pine-700 tabular-nums">{s.points}</td>
                      <td className="px-3 py-2 text-[11.5px] text-muted">{s.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* hard checks */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-pine-700">
              Generator hard checks
              <span
                className={
                  "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                  (allPass ? "bg-sage-100 text-sage-700" : "bg-gold-200 text-earth-600")
                }
              >
                {gen.checks.filter((c) => c.passed).length}/{gen.checks.length} pass
              </span>
            </h3>
            <ul className="space-y-1.5">
              {gen.checks.map((c) => (
                <li
                  key={c.code}
                  className="flex items-start gap-2.5 rounded-lg border border-line bg-cream/50 px-3 py-2"
                >
                  <span
                    className={
                      "mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full " +
                      (c.passed ? "bg-sage-400" : "bg-danger")
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      {c.label}{" "}
                      <span className="font-mono text-[10px] text-faint">{c.ref}</span>
                    </p>
                    <p className="text-[11.5px] text-muted">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Dave's recommendation */}
          <section className="rounded-xl border border-agent-500/30 bg-agent-100/50 p-4">
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-agent-700">
              Dave&apos;s recommendation (AI-MRV)
            </h3>
            <p className="mt-1 text-sm font-semibold text-ink">{advice.headline}</p>
            <ul className="mt-2 space-y-1">
              {advice.reasons.map((r, i) => (
                <li key={i} className="text-[12.5px] text-muted">
                  · {r}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-agent-500/20 pt-2 font-mono text-[10.5px] text-faint">
              Tier 1 states the reasoning deterministically; Dave phrases and defends it from Tier 2.
            </p>
          </section>

          {/* approve / reject */}
          <section className="flex flex-wrap gap-2 border-t border-line pt-4">
            <button
              disabled
              title="Approval writes to mrv.sampling_cycles — enabled once the module runs against the live database"
              className="cursor-not-allowed rounded-lg bg-pine-600/60 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Approve plan
            </button>
            <button
              disabled
              className="cursor-not-allowed rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-muted"
            >
              Reject + note
            </button>
            <span className="self-center font-mono text-[10.5px] text-faint">
              read-only in demo-data mode
            </span>
          </section>
        </div>
      </div>
    </div>
  );
}

function P({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className={"text-right font-medium " + (highlight ? "text-gold-600" : "text-ink")}>{v}</dd>
    </>
  );
}
