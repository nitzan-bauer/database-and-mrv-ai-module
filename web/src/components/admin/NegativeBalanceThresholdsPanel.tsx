"use client";

import { useState, useTransition } from "react";

export interface NegativeBalanceThreshold {
  settingKey: "alert_threshold_pct" | "block_threshold_pct";
  thresholdPct: number;
  updatedBy: string | null;
  updatedAt: string;
}

const LABELS: Record<NegativeBalanceThreshold["settingKey"], string> = {
  alert_threshold_pct: "Alert threshold (%) — email only",
  block_threshold_pct: "Block threshold (%) — blocks new deals too",
};

/**
 * Section 7.3's negative-balance thresholds (mrv.negative_balance_settings)
 * — admin (super_admin) only, per Nitzan's explicit request (2026-09-01).
 * Was hardcoded 30/20 until this panel existed. Read fresh every time
 * john_allocation_report runs (allocationBook/negativeBalance.ts) —
 * changing this only affects the NEXT run, never rewrites a past alert.
 */
export function NegativeBalanceThresholdsPanel({
  thresholds,
  save,
}: {
  thresholds: NegativeBalanceThreshold[];
  save: (settingKey: string, thresholdPct: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(thresholds.map((t) => [t.settingKey, String(t.thresholdPct)])),
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-bold text-pine-700">Negative-balance thresholds (Section 7.3)</h3>
      <p className="mt-1 text-[12.5px] text-muted">
        When a farm&apos;s or CarboNature&apos;s remaining share drops to or below the alert threshold, John
        emails an alert. At or below the block threshold, new deals are also refused for that
        farm/project until the balance recovers.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {thresholds.map((t) => (
          <label key={t.settingKey} className="block">
            <span className="text-[12px] font-semibold text-muted">{LABELS[t.settingKey]}</span>
            <input
              type="number"
              step="1"
              min="1"
              max="99"
              value={values[t.settingKey] ?? ""}
              onChange={(e) => {
                setValues((v) => ({ ...v, [t.settingKey]: e.target.value }));
                setMsg(null);
              }}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-pine-700"
            />
            <span className="mt-1 block font-mono text-[11px] text-faint">
              last set {new Date(t.updatedAt).toLocaleDateString("en-GB")} by {t.updatedBy ?? "—"}
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
              for (const t of thresholds) {
                const raw = values[t.settingKey];
                const parsed = Number(raw);
                if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0 || parsed >= 100) {
                  setMsg({ ok: false, text: `"${LABELS[t.settingKey]}" needs a whole number between 1 and 99.` });
                  return;
                }
              }
              for (const t of thresholds) {
                const parsed = Number(values[t.settingKey]);
                if (parsed === t.thresholdPct) continue;
                const result = await save(t.settingKey, parsed);
                if (!result.ok) {
                  setMsg({ ok: false, text: result.error ?? "Could not save." });
                  return;
                }
              }
              setMsg({ ok: true, text: "Saved — the next allocation report will use the new thresholds." });
            })
          }
          className="rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save thresholds"}
        </button>
        {msg && <span className={`text-[12.5px] ${msg.ok ? "text-sage-700" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
