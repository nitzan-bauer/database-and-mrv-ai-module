"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";

/* Shapes returned by /api/lab-imports/parse */
interface ParsedRow {
  rowIndex: number;
  sampleId: string;
  sampleType: "soc" | "texture";
  plotId: string | null;
  pointId: string | null;
  depthTopCm: number | null;
  depthBaseCm: number | null;
  bulkDensity: number | null;
  toc400Pct: number | null;
  roc600Pct: number | null;
  tocPct: number | null;
  socTPerHa: number | null;
  soilMassTHa: number | null;
  sheetTocPct: number | null;
  sheetSocTPerHa: number | null;
  sandPct: number | null;
  siltPct: number | null;
  clayPct: number | null;
  usdaClass: string | null;
  warnings: string[];
}
interface Quarantined {
  rowIndex: number;
  error: string;
  raw: Record<string, string>;
}
interface ParseResponse {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  datasheetVersion: string | null;
  parserStatus: "success" | "partial" | "quarantined";
  rows: ParsedRow[];
  quarantined: Quarantined[];
  summary: {
    total: number;
    soc: number;
    texture: number;
    plots: string[];
    workOrders: string[];
    labs: string[];
  };
}

export function LabImport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ParseResponse | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/lab-imports/parse", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "Could not read the workbook.");
      else setRes(j as ParseResponse);
    } catch {
      setError("Upload failed — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const warnCount = res?.rows.reduce((n, r) => n + r.warnings.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* drop zone */}
      <Card
        imprint
        className={
          "p-8 text-center transition-colors " + (drag ? "border-sage-400 bg-sage-50" : "")
        }
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) send(f);
          }}
        >
          <p className="text-sm font-semibold text-pine-700">
            Drop the datasheet here, or choose a file
          </p>
          <p className="mt-1 font-mono text-[11px] text-faint">
            .xlsx · CarboNature_SOC_Datasheet_v2.0 · up to 10 MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) send(f);
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-4 rounded-lg bg-pine-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:opacity-60"
          >
            {busy ? "Parsing…" : "Choose workbook"}
          </button>
        </div>
      </Card>

      {error && (
        <Card className="border-danger/40 p-4">
          <p className="text-sm font-semibold text-danger">Could not import</p>
          <p className="mt-1 text-[13px] text-muted">{error}</p>
        </Card>
      )}

      {res && (
        <>
          {/* summary */}
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Rows accepted" value={String(res.rows.length)} tone="sage" />
            <Stat
              label="Quarantined"
              value={String(res.quarantined.length)}
              tone={res.quarantined.length ? "danger" : "muted"}
            />
            <Stat label="Warnings" value={String(warnCount)} tone={warnCount ? "gold" : "muted"} />
            <Stat
              label="SOC · texture"
              value={`${res.summary.soc} · ${res.summary.texture}`}
              tone="pine"
            />
          </div>

          <Card className="p-4">
            <dl className="grid gap-x-8 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
              <Row k="File" v={res.fileName} mono />
              <Row k="Datasheet version" v={res.datasheetVersion ?? "—"} />
              <Row k="Plots" v={res.summary.plots.join(", ") || "—"} />
              <Row k="Work orders" v={res.summary.workOrders.join(", ") || "—"} />
              <Row k="Laboratories" v={res.summary.labs.join(", ") || "—"} />
              <Row k="SHA-256" v={res.sha256.slice(0, 32) + "…"} mono />
            </dl>
            <p className="mt-3 border-t border-line pt-2.5 font-mono text-[10.5px] text-faint">
              The raw workbook is kept for audit; the hash is what proves it was never edited after
              receipt.
            </p>
          </Card>

          {/* quarantine first — it is what needs action */}
          {res.quarantined.length > 0 && (
            <Card className="overflow-hidden border-danger/30">
              <div className="border-b border-line bg-danger/5 px-4 py-3">
                <h2 className="text-sm font-semibold text-danger">
                  Quarantined · {res.quarantined.length}
                </h2>
                <p className="font-mono text-[11px] text-faint">
                  Held out of the evidence tables with a reason — nothing is silently dropped
                </p>
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {res.quarantined.map((q) => (
                    <tr key={q.rowIndex} className="border-t border-line">
                      <td className="w-16 px-4 py-2 font-mono text-[11px] text-faint">
                        row {q.rowIndex}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted">
                        {q.raw.B ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-ink">{q.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* accepted rows */}
          {res.rows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-pine-700">
                  Accepted · {res.rows.length}
                </h2>
                <p className="font-mono text-[11px] text-faint">
                  TOC = TOC400 + ROC600 · SOC = TOC × BD × thickness × (1 − large CF), recomputed
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                      {["Row", "Sample", "Type", "Depth", "BD", "TOC400", "ROC600", "TOC", "SOC t/ha", "Sheet SOC", "Soil mass"].map(
                        (h) => (
                          <th key={h} className="px-3 py-2 font-semibold">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.map((r) => {
                      const mismatch =
                        r.socTPerHa != null &&
                        r.sheetSocTPerHa != null &&
                        Math.abs(r.socTPerHa - r.sheetSocTPerHa) > 0.05;
                      return (
                        <tr key={r.rowIndex} className="border-t border-line align-top">
                          <td className="px-3 py-2 font-mono text-[11px] text-faint">{r.rowIndex}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            {r.sampleId}
                            {r.warnings.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {r.warnings.map((w, i) => (
                                  <li key={i} className="font-sans text-[11px] text-gold-600">
                                    ⚠ {w}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-3 py-2">{r.sampleType}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {r.sampleType === "texture"
                              ? `${r.sandPct}/${r.siltPct}/${r.clayPct} ${r.usdaClass ?? ""}`
                              : `${r.depthTopCm}–${r.depthBaseCm} cm`}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{r.bulkDensity ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{r.toc400Pct ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{r.roc600Pct ?? "—"}</td>
                          <td className="px-3 py-2 font-semibold tabular-nums text-pine-700">
                            {r.tocPct ?? "—"}
                          </td>
                          <td className="px-3 py-2 font-semibold tabular-nums text-pine-700">
                            {r.socTPerHa ?? "—"}
                          </td>
                          <td
                            className={
                              "px-3 py-2 tabular-nums " + (mismatch ? "text-gold-600" : "text-muted")
                            }
                          >
                            {r.sheetSocTPerHa ?? "—"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted">
                            {r.soilMassTHa ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled
              title="Committing writes to mrv.lab_imports and mrv.soc_measurements — enabled against the live database"
              className="cursor-not-allowed rounded-lg bg-pine-600/60 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Commit {res.rows.length} rows
            </button>
            <span className="font-mono text-[10.5px] text-faint">
              read-only in demo-data mode · evidence tables are append-only
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "sage" | "gold" | "danger" | "pine" | "muted";
}) {
  const tones: Record<string, string> = {
    sage: "text-sage-600",
    gold: "text-gold-600",
    danger: "text-danger",
    pine: "text-pine-700",
    muted: "text-muted",
  };
  return (
    <Card className="p-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <p className={"mt-1 text-2xl font-bold tabular-nums " + tones[tone]}>{value}</p>
    </Card>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1">
      <dt className="text-muted">{k}</dt>
      <dd className={"text-right text-ink " + (mono ? "font-mono text-[11px]" : "")}>{v}</dd>
    </div>
  );
}
