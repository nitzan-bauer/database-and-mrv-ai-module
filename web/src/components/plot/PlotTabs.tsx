"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { PlotDetail } from "@/lib/data/types";
import { TABS, type Tab } from "./tabs";


const POINT_STATUS_STYLE: Record<string, string> = {
  planned: "bg-pine-50 text-pine-700",
  sampled: "bg-verify-100 text-verify-700",
  lab_pending: "bg-gold-200 text-earth-600",
  complete: "bg-sage-100 text-sage-700",
};

export function PlotTabs({ detail, initialTab }: { detail: PlotDetail; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "Overview");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors " +
              (tab === t
                ? "border-pine-600 text-pine-700"
                : "border-transparent text-muted hover:text-pine-600")
            }
          >
            {t}
            {t === "Sampling" && ` · ${detail.points.length}`}
            {t === "Lab" && ` · ${detail.soc.length}`}
          </button>
        ))}
      </div>

      {tab === "Overview" && <Overview detail={detail} />}
      {tab === "Sampling" && <Sampling detail={detail} />}
      {tab === "Lab" && <Lab detail={detail} />}
      {tab === "Photos" && <Photos detail={detail} />}
      {tab === "Model runs" && <ModelRuns detail={detail} />}
    </div>
  );
}

/* ─────────────────────────── Overview ─────────────────────────── */

function Overview({ detail }: { detail: PlotDetail }) {
  const { soc, texture, points, activities } = detail;

  // Latest SOC stock = sum of the two increments at the most recent analysis.
  const socByDepth = new Map<string, number[]>();
  for (const m of soc) {
    if (m.socTPerHa == null) continue;
    const k = `${m.depthTopCm}-${m.depthBaseCm}`;
    socByDepth.set(k, [...(socByDepth.get(k) ?? []), m.socTPerHa]);
  }
  const profileTotal = [...socByDepth.values()].reduce(
    (s, arr) => s + arr.reduce((a, b) => a + b, 0) / arr.length,
    0,
  );
  const tex = texture[0];
  const done = points.filter((p) => p.status === "complete").length;
  const labPending = points.filter((p) => p.status === "lab_pending").length;

  const removal = activities
    .filter((a) => a.activityType === "biofertilizer")
    .reduce((s, a) => s + (a.product?.creditPerHa ?? 0) * (a.applicationAreaHa ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          label="Latest SOC stock"
          value={profileTotal > 0 ? `${profileTotal.toFixed(1)} t C/ha` : "—"}
          hint="0–15 + 15–30 cm · ESM basis"
          tone="pine"
        />
        <Stat
          label="Soil texture (USDA)"
          value={tex ? tex.usdaClass : "—"}
          hint={
            tex
              ? `sand ${tex.sandPct} · silt ${tex.siltPct} · clay ${tex.clayPct}`
              : "first-round texture test pending"
          }
        />
        <Stat
          label="Sampling status"
          value={labPending > 0 ? "Lab pending" : done === points.length ? "Complete" : "In progress"}
          hint={`${done}/${points.length} points complete · cycle 1`}
          tone={labPending > 0 ? "gold" : "sage"}
        />
      </div>

      <Card imprint className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-pine-700">
            Project Activities — from marketplace
          </h3>
          <span className="rounded-full bg-sage-100 px-2.5 py-1 text-xs font-medium text-sage-700">
            ~{removal.toFixed(0)} tCO₂e removal (ex-ante)
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {activities.map((a) => (
            <div key={a.activityId} className="rounded-xl border border-line bg-cream/60 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {a.product?.activityLabel ?? a.activityType}
                  </p>
                  <p className="font-mono text-[11px] text-faint">{a.product?.name}</p>
                </div>
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                    (a.activityType === "biofertilizer"
                      ? "bg-sage-100 text-sage-700"
                      : "bg-gold-200 text-earth-600")
                  }
                >
                  {a.activityType === "biofertilizer" ? "removal" : "avoidance"}
                </span>
              </div>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <Row k="Rate" v={a.rate != null ? `${a.rate} ${a.rateUnit ?? ""}` : "—"} />
                <Row k="Area" v={a.applicationAreaHa ? `${a.applicationAreaHa} ha` : "—"} />
                <Row k="Applied" v={a.applicationDate ?? "—"} />
                <Row
                  k="Ex-ante"
                  v={a.product?.creditPerHa ? `${a.product.creditPerHa} tCO₂e/ha` : "—"}
                />
              </dl>
              {a.notes && <p className="mt-2 text-[11.5px] text-muted">{a.notes}</p>}
            </div>
          ))}
          {!activities.length && (
            <p className="text-sm text-muted">No Project Activities recorded for this plot yet.</p>
          )}
        </div>
        <p className="mt-3 border-t border-line pt-2.5 font-mono text-[11px] text-faint">
          Avoidance credits are quantified by the GHG Calculator (QA3) · removals by the SOC model
          (QA1/QA2) — the forecast combines both.
        </p>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Sampling ─────────────────────────── */

function Sampling({ detail }: { detail: PlotDetail }) {
  const { points, samples } = detail;
  return (
    <Card className="overflow-hidden">
      <Table
        head={["Point", "Scenario", "Cores", "Samples", "Status"]}
        rows={points.map((p) => {
          const mine = samples.filter((s) => s.pointId === p.pointId);
          return [
            <span key="id" className="font-mono text-xs">
              {p.pointId}
            </span>,
            p.scenario,
            p.compositeCores ?? "—",
            mine.length ? `${mine.length} (${mine.filter((s) => s.sampleType === "soc").length} SOC + ${mine.filter((s) => s.sampleType === "texture").length} texture)` : "—",
            <Badge key="s" className={POINT_STATUS_STYLE[p.status]}>
              {p.status.replace("_", " ")}
            </Badge>,
          ];
        })}
      />
      <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-faint">
        VM0042 §8.2.1.2 — ≥5 composite samples per stratum; every first-round point also carries a
        soil-texture test.
      </p>
    </Card>
  );
}

/* ───────────────────────────── Lab ───────────────────────────── */

function Lab({ detail }: { detail: PlotDetail }) {
  const { soc, texture } = detail;
  if (!soc.length)
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">
          No lab results yet. They arrive with the SOC Datasheet v2.0 ingestion (Slice 6).
        </p>
      </Card>
    );
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <SectionHead
          title="SOC measurements"
          note="DIN 19539 fractions · TOC = TOC400 + ROC600 · dry combustion"
        />
        <Table
          head={["Sample", "Depth", "BD", "TOC400", "ROC600", "TOC %", "SOC t C/ha"]}
          rows={soc.map((m) => [
            <span key="s" className="font-mono text-xs">
              {m.sampleId}
            </span>,
            `${m.depthTopCm}–${m.depthBaseCm} cm`,
            m.bulkDensity?.toFixed(2) ?? "—",
            m.toc400Pct?.toFixed(3) ?? "—",
            m.roc600Pct?.toFixed(3) ?? "—",
            <b key="t" className="text-pine-700">
              {m.tocPct?.toFixed(3) ?? "—"}
            </b>,
            <b key="v" className="text-pine-700">
              {m.socTPerHa?.toFixed(2) ?? "—"}
            </b>,
          ])}
        />
      </Card>
      {texture.length > 0 && (
        <Card className="overflow-hidden">
          <SectionHead title="Texture" note="drives stratification · sum = 100" />
          <Table
            head={["Sample", "Depth", "Sand", "Silt", "Clay", "USDA class"]}
            rows={texture.map((t) => [
              <span key="s" className="font-mono text-xs">
                {t.sampleId}
              </span>,
              t.depthCm != null ? `${t.depthCm} cm` : "—",
              `${t.sandPct}%`,
              `${t.siltPct}%`,
              `${t.clayPct}%`,
              <b key="c" className="text-pine-700">
                {t.usdaClass}
              </b>,
            ])}
          />
        </Card>
      )}
    </div>
  );
}

/* ────────────────────────── Photos ────────────────────────── */

function Photos({ detail }: { detail: PlotDetail }) {
  const { samples } = detail;
  return (
    <Card className="overflow-hidden">
      <SectionHead title="Photos & barcodes" note="captured in the field over MCP (Slice 5)" />
      <Table
        head={["Sample", "Barcode", "Sampled", "GPS Δ", "Photo", "Notes"]}
        rows={samples.map((s) => [
          <span key="s" className="font-mono text-xs">
            {s.sampleId}
          </span>,
          <span key="b" className="font-mono text-xs text-muted">
            {s.barcode ?? "—"}
          </span>,
          s.samplingDate ?? "—",
          s.distanceFromTargetM != null ? `${s.distanceFromTargetM.toFixed(1)} m` : "—",
          s.photoUrl ? (
            <a key="p" href={s.photoUrl} className="text-verify-500 underline">
              view
            </a>
          ) : (
            <span key="p" className="text-faint">
              pending
            </span>
          ),
          <span key="n" className="text-muted">
            {s.fieldNotes ?? "—"}
          </span>,
        ])}
      />
    </Card>
  );
}

/* ───────────────────────── Model runs ───────────────────────── */

function ModelRuns({ detail }: { detail: PlotDetail }) {
  const { modelRuns } = detail;
  if (!modelRuns.length)
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">No model runs for this farm yet (Model Run Console).</p>
      </Card>
    );
  return (
    <Card className="overflow-hidden">
      <SectionHead title="Model runs (QA1)" note="DNDC / DayCent · paired baseline + project" />
      <Table
        head={["Run", "Model", "Type", "Period", "Uncertainty", "Status"]}
        rows={modelRuns.map((r) => [
          <span key="r" className="font-mono text-xs">
            {r.runId}
          </span>,
          `${r.model} ${r.modelVersion ?? ""}`,
          r.runType ?? "—",
          r.periodStart && r.periodEnd ? `${r.periodStart} → ${r.periodEnd}` : "—",
          r.uncertaintyMethod === "monte_carlo"
            ? `Monte Carlo · L=${r.monteCarloIters}`
            : (r.uncertaintyMethod ?? "—"),
          <Badge key="s" className="bg-sage-100 text-sage-700">
            {r.status}
          </Badge>,
        ])}
      />
    </Card>
  );
}

/* ──────────────────────────── bits ──────────────────────────── */

function Stat({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "pine" | "sage" | "gold";
}) {
  const tones: Record<string, string> = {
    ink: "text-ink",
    pine: "text-pine-700",
    sage: "text-sage-600",
    gold: "text-gold-600",
  };
  return (
    <Card className="p-5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <p className={"mt-1.5 text-xl font-bold " + tones[tone]}>{value}</p>
      <p className="mt-1 font-mono text-[11px] text-faint">{hint}</p>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium text-ink">{v}</dd>
    </>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={"rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " + className}>
      {children}
    </span>
  );
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <h3 className="text-sm font-semibold text-pine-700">{title}</h3>
      <p className="font-mono text-[11px] text-faint">{note}</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-cream text-left font-mono text-[11px] uppercase tracking-wide text-faint">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
