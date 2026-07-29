"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { ActivityData, EmissionResult, GhgParameters, WorkingLine } from "@/lib/ghg/engine";
import type { ParameterExplanation, ToolSpec } from "@/lib/ghg/skill";

interface Reduction {
  baseline: EmissionResult;
  project: EmissionResult;
  reduction: { perHa: number; total: number };
  areaHa: number;
}

export function GhgView({
  farms,
  activeFarmId,
  parameters,
  parameterExplanations,
  activity,
  reduction,
  workingBsl,
  workingPr,
  tools,
}: {
  farms: Array<{ farmId: string; name: string; climateZone: string }>;
  activeFarmId: string;
  parameters: GhgParameters;
  parameterExplanations: ParameterExplanation[];
  activity: ActivityData[];
  reduction: Reduction | null;
  workingBsl: WorkingLine[] | null;
  workingPr: WorkingLine[] | null;
  tools: ToolSpec[];
}) {
  const [scenario, setScenario] = useState<"BSL" | "PR">("BSL");
  const [showSkill, setShowSkill] = useState(false);

  const working = scenario === "BSL" ? workingBsl : workingPr;
  const ad = activity.find((a) => a.scenario === scenario);
  const result = reduction ? (scenario === "BSL" ? reduction.baseline : reduction.project) : null;

  return (
    <div className="space-y-4">
      {/* farm switcher */}
      <div className="flex flex-wrap items-center gap-2">
        {farms.map((f) => (
          <Link
            key={f.farmId}
            href={`/ghg?farm=${f.farmId}`}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (f.farmId === activeFarmId
                ? "bg-pine-600 text-white"
                : "border border-line bg-white text-pine-700 hover:bg-pine-50")
            }
          >
            {f.name}
            <span className="ml-1.5 opacity-70">{f.climateZone}</span>
          </Link>
        ))}
        <button
          onClick={() => setShowSkill((s) => !s)}
          className="ml-auto rounded-full border border-agent-500/40 bg-agent-100 px-3 py-1.5 text-xs font-semibold text-agent-700 hover:bg-agent-100/70"
        >
          {showSkill ? "Hide" : "Show"} Dave&apos;s skill
        </button>
      </div>

      {/* The parameter set carries its own climate zone and is what the
          engine uses. Where the farm's recorded zone differs, say so —
          silently applying a wet-climate factor to a dry farm is exactly the
          kind of thing a VVB asks about. */}
      {(() => {
        const farm = farms.find((f) => f.farmId === activeFarmId);
        if (!farm || farm.climateZone === parameters.climateZone) return null;
        return (
          <div className="rounded-xl border-l-4 border-gold-500 bg-gold-200/30 px-4 py-3">
            <p className="text-[13px] font-semibold text-earth-600">
              Climate zone mismatch — {farm.name} is recorded as{" "}
              <b>{farm.climateZone}</b>, but parameter set {parameters.version} is{" "}
              <b>{parameters.climateZone}</b>.
            </p>
            <p className="mt-1 text-[12px] text-muted">
              The engine uses the parameter set, as the database does, so the factors below are{" "}
              {parameters.climateZone}-climate values. A grouped project spanning both zones needs a
              parameter set per farm, or one farm is quantified on the wrong EF_N_direct and
              Frac_LEACH.
            </p>
          </div>
        );
      })()}

      {/* headline */}
      {reduction && (
        <div className="grid gap-4 md:grid-cols-3">
          <Stat
            label="Baseline (3-yr average)"
            value={`${reduction.baseline.totalPerHa.toFixed(4)}`}
            unit="tCO₂e/ha"
          />
          <Stat
            label="Project year"
            value={`${reduction.project.totalPerHa.toFixed(4)}`}
            unit="tCO₂e/ha"
          />
          <Stat
            label="Emission reduction"
            value={`${reduction.reduction.perHa.toFixed(4)}`}
            unit={`tCO₂e/ha · ${reduction.reduction.total.toFixed(1)} tCO₂e over ${reduction.areaHa} ha`}
            tone="sage"
          />
        </div>
      )}

      {/* Dave's skill surface */}
      {showSkill && (
        <Card className="border-agent-500/30 bg-agent-100/40 p-5">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-agent-700">
            Dave · GHG-Calculator skill (Tier-2 pilot)
          </h2>
          <p className="mt-1.5 max-w-3xl text-[13px] text-muted">
            The engine below is a plain tested function; the skill is a declared tool surface over
            it. Tier 2 adds orchestration and language, nothing arithmetic — so the agent and this
            screen can never report different numbers.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {tools.map((t) => (
              <div key={t.name} className="rounded-xl border border-line bg-white p-3">
                <p className="font-mono text-[12px] font-semibold text-agent-700">{t.name}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{t.description}</p>
                {Object.keys(t.input).length > 0 && (
                  <p className="mt-1.5 font-mono text-[10px] text-faint">
                    {Object.entries(t.input)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* scenario tabs */}
      <div className="flex gap-1 border-b border-line">
        {(["BSL", "PR"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScenario(s)}
            className={
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors " +
              (scenario === s
                ? "border-pine-600 text-pine-700"
                : "border-transparent text-muted hover:text-pine-600")
            }
          >
            {s === "BSL" ? "Baseline" : "Project"}
            {ad && s === scenario && (
              <span className="ml-1.5 font-mono text-[11px] text-faint">{ad.year}</span>
            )}
          </button>
        ))}
      </div>

      {/* activity data */}
      {ad && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-pine-700">
            Activity data · {ad.year} · {ad.areaHa} ha
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
                Fuel &amp; residue
              </p>
              <dl className="space-y-1 text-[13px]">
                <KV k="Diesel" v={`${ad.dieselL.toLocaleString()} L`} />
                <KV k="Gasoline" v={`${ad.gasolineL.toLocaleString()} L`} />
                <KV k="Residue burnt" v={`${ad.residueBurntKg.toLocaleString()} kg`} />
                <KV
                  k="N-fixing residue"
                  v={`${ad.nfixDryMatterT} t d.m. × ${ad.nfixNContent} N`}
                />
              </dl>
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
                Fertiliser applications
              </p>
              <dl className="space-y-1 text-[13px]">
                {ad.fertilizers.map((f, i) => (
                  <KV
                    key={i}
                    k={`${f.fertilizerName} (${f.class})`}
                    v={`${f.massT} t × ${(f.nContent * 100).toFixed(1)}% N${f.intervalYears > 1 ? ` ÷ ${f.intervalYears} yr` : ""}`}
                  />
                ))}
              </dl>
            </div>
          </div>
        </Card>
      )}

      {/* the working */}
      {working && result && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-pine-700">
              The working · VM0042 equations
            </h2>
            <p className="font-mono text-[11px] text-faint">
              every figure traceable to its equation, inputs and factor
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">Eq</th>
                  <th className="px-3 py-2 font-semibold">Term</th>
                  <th className="px-3 py-2 font-semibold">As evaluated</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                  <th className="px-3 py-2 font-semibold">Unit</th>
                </tr>
              </thead>
              <tbody>
                {working.map((w, i) => {
                  const isTotal = w.eq === "17";
                  return (
                    <tr
                      key={i}
                      className={
                        "border-t border-line " + (isTotal ? "bg-pine-50 font-semibold" : "")
                      }
                    >
                      <td className="px-3 py-2 font-mono text-[11px] text-forest">{w.eq}</td>
                      <td className={"px-3 py-2 " + (isTotal ? "text-pine-700" : "text-ink")}>
                        {w.label}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-muted">
                        {w.expression}
                      </td>
                      <td
                        className={
                          "px-3 py-2 text-right tabular-nums " +
                          (isTotal ? "text-pine-700" : "text-ink")
                        }
                      >
                        {w.value.toFixed(4)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-faint">{w.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.soilN2OExcluded && (
            <p className="border-t border-line bg-gold-200/30 px-4 py-2.5 text-[12px] text-earth-600">
              Soil N₂O is excluded from the total under {parameters.soilN2OApproach} — it comes from
              the model instead, and counting both would double-count the same emission.
            </p>
          )}
        </Card>
      )}

      {/* parameters, explained */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-pine-700">
          Parameter set · {parameters.version}
        </h2>
        <p className="mb-3 font-mono text-[11px] text-faint">
          climate {parameters.climateZone} · N trend {parameters.nTrend} · approach{" "}
          {parameters.soilN2OApproach}
        </p>
        <div className="space-y-2">
          {parameterExplanations.map((e) => (
            <div key={e.key} className="rounded-xl border border-line bg-cream/50 px-3.5 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] font-semibold text-pine-700">{e.key}</span>
                <span className="font-mono text-[13px] font-bold text-ink">{e.resolved}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{e.why}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">{e.ref}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "sage";
}) {
  return (
    <Card className="p-5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <p
        className={
          "mt-1 text-2xl font-bold tabular-nums " +
          (tone === "sage" ? "text-sage-600" : "text-pine-700")
        }
      >
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10.5px] text-faint">{unit}</p>
    </Card>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/60 pb-0.5">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium text-ink">{v}</dd>
    </div>
  );
}
