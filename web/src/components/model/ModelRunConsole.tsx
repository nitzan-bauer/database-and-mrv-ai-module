import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { UncertaintyResult } from "@/lib/model/uncertainty";
import type { ModelInputStatus } from "@/lib/data/fixtures";

interface StratumRow {
  stratumCode: string;
  plotId: string;
  areaHa: number;
  deltaSocWpTHa: number;
  deltaSocBslTHa: number;
  varModel: number;
  varSampling: number;
  netTHa: number;
}

const STATE_STYLE: Record<string, string> = {
  ready: "bg-sage-100 text-sage-700",
  partial: "bg-gold-200 text-earth-600",
  missing: "bg-danger/10 text-danger",
};

export function ModelRunConsole({
  inputs,
  log,
  strata,
  totalAreaHa,
  meanNetTHa,
  varModel,
  varSampling,
  uncertainty,
}: {
  inputs: ModelInputStatus[];
  log: Array<{ t: string; line: string; kind: "info" | "step" | "done" }>;
  strata: StratumRow[];
  totalAreaHa: number;
  meanNetTHa: number;
  varModel: number;
  varSampling: number;
  uncertainty: UncertaintyResult;
}) {
  const notReady = inputs.filter((i) => i.state !== "ready");
  const mc = uncertainty.path === "monte_carlo";

  return (
    <div className="space-y-4">
      {/* run header */}
      <Card imprint className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] text-faint">run-2026-c1-dndc</p>
            <h2 className="text-lg font-bold text-pine-700">Elad Farm · cycle 1 · DNDC v9.5</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              paired baseline + project · {totalAreaHa.toFixed(2)} ha · 2023-01-01 → 2026-06-30
            </p>
          </div>
          <span className="rounded-full bg-sage-100 px-3 py-1 text-xs font-semibold text-sage-700">
            completed
          </span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* inputs */}
        <Card className="p-4">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
            Inputs
          </h3>
          <ul className="mt-2 space-y-2">
            {inputs.map((i) => (
              <li key={i.label} className="flex items-start gap-2.5">
                <span
                  className={
                    "mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold " +
                    STATE_STYLE[i.state]
                  }
                >
                  {i.state}
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">{i.label}</p>
                  <p className="text-[11px] leading-snug text-muted">{i.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {notReady.length > 0 && (
            <p className="mt-3 border-t border-line pt-2 text-[11.5px] text-gold-600">
              {notReady.length} input{notReady.length === 1 ? "" : "s"} incomplete — the run
              proceeds, but a true-up short of its points widens the variance and so deepens the
              deduction.
            </p>
          )}
        </Card>

        {/* log */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5">
            <h3 className="text-sm font-semibold text-pine-700">Run log</h3>
            <p className="font-mono text-[10.5px] text-faint">
              ECS Fargate · streamed to S3 alongside the input manifest
            </p>
          </div>
          <div className="max-h-[260px] overflow-auto bg-pine-900 p-3.5">
            {log.map((l, i) => (
              <div key={i} className="flex gap-3 py-0.5 font-mono text-[11px]">
                <span className="shrink-0 text-pine-400">{l.t}</span>
                <span
                  className={
                    l.kind === "done"
                      ? "text-sage-300"
                      : l.kind === "step"
                        ? "text-white"
                        : "text-pine-200"
                  }
                >
                  {l.line}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* per-stratum results */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-pine-700">
            Per-stratum SOC change · mrv.model_results
          </h3>
          <p className="font-mono text-[10.5px] text-faint">
            net = project − baseline, as the generated column computes it
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                {["Stratum", "Area", "ΔSOC project", "ΔSOC baseline", "Net", "Var model", "Var sampling"].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {strata.map((s) => (
                <tr key={`${s.plotId}-${s.stratumCode}`} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {s.plotId} · {s.stratumCode}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{s.areaHa.toFixed(2)} ha</td>
                  <td className="px-3 py-2 tabular-nums">{s.deltaSocWpTHa.toFixed(4)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {s.deltaSocBslTHa.toFixed(4)}
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums text-pine-700">
                    {s.netTHa.toFixed(4)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">{s.varModel.toFixed(4)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">{s.varSampling.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Equation 74 */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-pine-700">
              Uncertainty deduction · Equation 74
            </h3>
            <p className="font-mono text-[10.5px] text-faint">
              VM0042 §8.6.4 · probability of exceedance at the 33.3rd percentile
            </p>
          </div>
          <div className="flex gap-1.5">
            {(["monte_carlo", "analytical"] as const).map((p) => (
              <Link
                key={p}
                href={`/model-runs?path=${p}`}
                className={
                  "rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors " +
                  (uncertainty.path === p
                    ? "bg-agent-500 text-white"
                    : "border border-line bg-white text-muted hover:bg-cream")
                }
              >
                {p === "monte_carlo" ? "Monte Carlo" : "Analytical"}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <Metric label="Mean net ERR" value={meanNetTHa.toFixed(4)} unit="t CO₂e/ha" />
          <Metric
            label="Standard error"
            value={uncertainty.standardError.toFixed(4)}
            unit={`t CO₂e/ha · t = ${uncertainty.tValue}`}
          />
          <Metric
            label="Deduction"
            value={`${uncertainty.deductionPct.toFixed(1)}%`}
            unit="Equation 74"
            tone="gold"
          />
          <Metric
            label="Claimable after deduction"
            value={uncertainty.netAfterDeductionTHa.toFixed(4)}
            unit="t CO₂e/ha"
            tone="sage"
          />
        </div>

        <div className="mt-4 rounded-xl border border-line bg-cream/60 p-3.5">
          <p className="font-mono text-[11px] leading-relaxed text-muted">
            UNC% = t<sub>0.667</sub> × √Var(ERR) ÷ ERR × 100 ={" "}
            {uncertainty.tValue} × {uncertainty.standardError.toFixed(4)} ÷ {meanNetTHa.toFixed(4)} ×
            100 = <b className="text-gold-600">{uncertainty.deductionPct.toFixed(3)}%</b>
          </p>
          <p className="mt-2 text-[12px] text-ink">
            {mc ? (
              <>
                <b>Monte Carlo path</b> (Eqs. 65–69): both variance terms are divided by area, so
                Var(mean) = (var<sub>model</sub> {varModel.toFixed(4)} + var
                <sub>sampling</sub> {varSampling.toFixed(4)}) ÷ {totalAreaHa.toFixed(2)} ={" "}
                {uncertainty.varMean.toExponential(3)}.
              </>
            ) : (
              <>
                <b>Analytical path</b> (Eqs. 60–64): only the sampling term is divided by area, so
                Var(mean) = var<sub>model</sub> {varModel.toFixed(4)} + var
                <sub>sampling</sub> {varSampling.toFixed(4)} ÷ {totalAreaHa.toFixed(2)} ={" "}
                {uncertainty.varMean.toExponential(3)}.
              </>
            )}
          </p>
          <p className="mt-2 text-[12px] text-muted">
            Precision is worth money here: the deduction scales with the standard error, so halving
            it halves what is given away. That is the argument for more composites per stratum, not
            fewer.
          </p>
        </div>
      </Card>

      {/* MVR / IME */}
      <Card className="border-l-4 border-l-verify-500 p-5">
        <h3 className="text-sm font-semibold text-verify-700">
          Model Validation Report &amp; the IME · VMD0053 §5.2
        </h3>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">
          Dave generates the MVR from this run — mean bias against pooled measurement uncertainty,
          coverage, and the parameter set used. It is then reviewed and signed by an Independent
          Modeling Expert.
        </p>
        <div className="mt-3 rounded-xl border border-verify-500/30 bg-verify-100/60 px-4 py-3">
          <p className="text-[13px] font-semibold text-verify-700">
            The IME is contracted by the VVB, never by CarboNature.
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            The database records this explicitly — <code className="font-mono text-[11px]">mrv.mvr.ime_contracted_by</code>{" "}
            defaults to <code className="font-mono text-[11px]">&apos;VVB&apos;</code> — because an
            expert paid by the proponent is not independent, and a verifier will ask.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled
            title="Generating the MVR writes to mrv.mvr — enabled against the live database"
            className="cursor-not-allowed rounded-lg bg-verify-500/60 px-4 py-2 text-sm font-semibold text-white"
          >
            Generate MVR
          </button>
          <span className="self-center font-mono text-[10.5px] text-faint">
            status: draft → ime_review → signed
          </span>
        </div>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "gold" | "sage";
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-3.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <p
        className={
          "mt-1 text-xl font-bold tabular-nums " +
          (tone === "gold" ? "text-gold-600" : tone === "sage" ? "text-sage-600" : "text-pine-700")
        }
      >
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-faint">{unit}</p>
    </div>
  );
}
