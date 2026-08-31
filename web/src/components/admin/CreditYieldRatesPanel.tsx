"use client";

import { useState, useTransition } from "react";

export interface CreditYieldRate {
  plotType: "open_field" | "young_orchard" | "mature_orchard";
  ratePerHa: number;
  updatedBy: string | null;
  updatedAt: string;
}

const LABELS: Record<CreditYieldRate["plotType"], string> = {
  open_field: "Open field",
  young_orchard: "Young orchard (planted within 3 years)",
  mature_orchard: "Mature orchard",
};

/**
 * John's credit-yield-per-hectare rates (mrv.credit_yield_rate_table) —
 * admin (super_admin) only, per Nitzan's explicit request. Editing here
 * only changes rates going forward (john_credit_potential_estimate reads
 * this table on its next weekly run); past estimates are never rewritten
 * retroactively.
 */
export function CreditYieldRatesPanel({
  rates,
  save,
}: {
  rates: CreditYieldRate[];
  save: (plotType: string, ratePerHa: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(rates.map((r) => [r.plotType, String(r.ratePerHa)])),
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-bold text-pine-700">Credit-yield rates (tCO2e / hectare)</h3>
      <p className="mt-1 text-[12.5px] text-muted">
        Used to estimate a farm&apos;s credit potential before any soil-sampling round has run. Only
        affects estimates computed going forward — nothing here rewrites a past estimate.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {rates.map((r) => (
          <label key={r.plotType} className="block">
            <span className="text-[12px] font-semibold text-muted">{LABELS[r.plotType]}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={values[r.plotType] ?? ""}
              onChange={(e) => {
                setValues((v) => ({ ...v, [r.plotType]: e.target.value }));
                setMsg(null);
              }}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-pine-700"
            />
            <span className="mt-1 block font-mono text-[11px] text-faint">
              last set {new Date(r.updatedAt).toLocaleDateString("en-GB")} by {r.updatedBy ?? "—"}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              for (const r of rates) {
                const raw = values[r.plotType];
                const parsed = Number(raw);
                if (raw === undefined || Number.isNaN(parsed) || parsed < 0) {
                  setMsg({ ok: false, text: `"${LABELS[r.plotType]}" needs a non-negative number.` });
                  return;
                }
              }
              for (const r of rates) {
                const parsed = Number(values[r.plotType]);
                if (parsed === r.ratePerHa) continue; // unchanged — skip the write
                const result = await save(r.plotType, parsed);
                if (!result.ok) {
                  setMsg({ ok: false, text: result.error ?? "Could not save." });
                  return;
                }
              }
              setMsg({ ok: true, text: "Saved — future estimates will use the new rates." });
            })
          }
          className="rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save rates"}
        </button>
        {msg && <span className={`text-[12.5px] ${msg.ok ? "text-sage-700" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
