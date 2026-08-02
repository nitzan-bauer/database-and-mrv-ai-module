"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RecordedActivityData } from "@/lib/tools/recordActivityData";
import type { ToolResult } from "@/lib/tools/context";

interface FertilizerRow {
  fertilizerName: string;
  massT: string;
  intervalYears: string;
}

const emptyRow: FertilizerRow = { fertilizerName: "", massT: "", intervalYears: "1" };

/**
 * Enter one farm/scenario/year of GHG Calculator inputs directly — the same
 * write recordActivityData exposes to an agent, called here under the
 * signed-in person's own identity instead. Fertiliser names are a select
 * over the real mrv.fertilizers catalog, not free text, so the n_content
 * and class the engine depends on always come from the catalog rather than
 * from a retyped guess.
 */
export function ActivityDataForm({
  farmId,
  fertilizers,
  action,
}: {
  farmId: string;
  fertilizers: Array<{ name: string; nContent: number; class: string }>;
  action: (input: {
    farmId: string;
    scenario: "BSL" | "PR" | "WP";
    year: number;
    areaHa: number;
    dieselL?: number;
    gasolineL?: number;
    residueBurntKg?: number;
    nfixDryMatterT?: number;
    nfixNContent?: number;
    fertilizers: Array<{ fertilizerName: string; massT: number; intervalYears?: number }>;
  }) => Promise<ToolResult<RecordedActivityData>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<"BSL" | "PR">("BSL");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [areaHa, setAreaHa] = useState("");
  const [dieselL, setDieselL] = useState("0");
  const [gasolineL, setGasolineL] = useState("0");
  const [residueBurntKg, setResidueBurntKg] = useState("0");
  const [nfixDryMatterT, setNfixDryMatterT] = useState("0");
  const [nfixNContent, setNfixNContent] = useState("0");
  const [rows, setRows] = useState<FertilizerRow[]>([{ ...emptyRow }]);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<RecordedActivityData> | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-pine-700 transition-colors hover:bg-pine-50"
      >
        + Record activity data
      </button>
    );
  }

  const canSubmit = year.trim() && areaHa.trim() && rows.every((r) => !r.fertilizerName || r.massT.trim());

  function submit() {
    start(async () => {
      const cleanRows = rows.filter((r) => r.fertilizerName.trim());
      const res = await action({
        farmId,
        scenario,
        year: Number(year),
        areaHa: Number(areaHa),
        dieselL: Number(dieselL || 0),
        gasolineL: Number(gasolineL || 0),
        residueBurntKg: Number(residueBurntKg || 0),
        nfixDryMatterT: Number(nfixDryMatterT || 0),
        nfixNContent: Number(nfixNContent || 0),
        fertilizers: cleanRows.map((r) => ({
          fertilizerName: r.fertilizerName,
          massT: Number(r.massT),
          intervalYears: r.intervalYears.trim() ? Number(r.intervalYears) : undefined,
        })),
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-pine-700">Record activity data</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11.5px] text-faint hover:text-pine-700"
        >
          close
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-muted">
          Scenario
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as "BSL" | "PR")}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          >
            <option value="BSL">BSL — baseline</option>
            <option value="PR">PR — project year</option>
          </select>
        </label>
        <label className="text-[11px] text-muted">
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
        <label className="text-[11px] text-muted">
          Area (ha)
          <input
            type="number"
            step="0.01"
            value={areaHa}
            onChange={(e) => setAreaHa(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-[11px] text-muted">
          Diesel (L)
          <input
            type="number"
            step="0.01"
            value={dieselL}
            onChange={(e) => setDieselL(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
        <label className="text-[11px] text-muted">
          Gasoline (L)
          <input
            type="number"
            step="0.01"
            value={gasolineL}
            onChange={(e) => setGasolineL(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
        <label className="text-[11px] text-muted">
          Residue burnt (kg)
          <input
            type="number"
            step="0.01"
            value={residueBurntKg}
            onChange={(e) => setResidueBurntKg(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
        <label className="text-[11px] text-muted">
          N-fix dry matter (t)
          <input
            type="number"
            step="0.0001"
            value={nfixDryMatterT}
            onChange={(e) => setNfixDryMatterT(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
        <label className="text-[11px] text-muted">
          N-fix N content (0-1)
          <input
            type="number"
            step="0.0001"
            min="0"
            max="1"
            value={nfixNContent}
            onChange={(e) => setNfixNContent(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </label>
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-semibold text-muted">Fertiliser applications</p>
        <div className="mt-1 space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                value={row.fertilizerName}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], fertilizerName: e.target.value };
                  setRows(next);
                }}
                className="flex-1 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              >
                <option value="">— none —</option>
                {fertilizers.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.class}, N {(f.nContent * 100).toFixed(1)}%)
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.0001"
                placeholder="mass (t)"
                value={row.massT}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], massT: e.target.value };
                  setRows(next);
                }}
                className="w-24 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              />
              <input
                type="number"
                step="1"
                min="1"
                placeholder="interval yrs"
                value={row.intervalYears}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], intervalYears: e.target.value };
                  setRows(next);
                }}
                className="w-24 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              />
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="text-[11px] text-faint hover:text-danger"
              >
                remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRows([...rows, { ...emptyRow }])}
          className="mt-1.5 text-[11.5px] font-semibold text-pine-700 hover:underline"
        >
          + add fertiliser
        </button>
      </div>

      <button
        type="button"
        disabled={!canSubmit || pending}
        onClick={submit}
        className="mt-3 rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>

      {result && !result.ok && (
        <p className="mt-2 text-[12px] text-danger">{result.error}</p>
      )}
      {result?.ok && (
        <p className="mt-2 text-[12px] text-sage-700">
          Saved {result.data.activityDataId.slice(0, 8)} — {result.data.fertilizerCount} fertiliser
          line{result.data.fertilizerCount === 1 ? "" : "s"}, {result.data.totalNAppliedT} t N applied.
        </p>
      )}
    </div>
  );
}
