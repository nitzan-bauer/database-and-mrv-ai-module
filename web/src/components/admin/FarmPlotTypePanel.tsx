"use client";

import { useState, useTransition } from "react";

export interface FarmPlotType {
  farmId: string;
  farmName: string;
  projectDefault: string | null;
  override: string | null;
}

const PLOT_TYPE_LABELS: Record<string, string> = {
  open_field: "Open field",
  young_orchard: "Young orchard (9 tCO2e/ha)",
  mature_orchard: "Mature orchard (3 tCO2e/ha)",
};

/**
 * Per-farm plot-type override (mrv.farms.plot_type_override) — admin
 * (super_admin) decides, per farm, whether it's a young or mature orchard
 * (a real, meaningful distinction with no other signal to derive it from),
 * per Nitzan's explicit request (2026-09-01). Empty selection = "use the
 * project default" (mrv.project_plot_type_defaults), exactly as before
 * this override existed. Only affects estimates computed going forward.
 */
export function FarmPlotTypePanel({
  farms,
  save,
}: {
  farms: FarmPlotType[];
  save: (farmId: string, plotType: string | null) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(farms.map((f) => [f.farmId, f.override ?? ""])),
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-bold text-pine-700">Farm plot type (young vs. mature orchard)</h3>
      <p className="mt-1 text-[12.5px] text-muted">
        &quot;Use project default&quot; means the farm follows its project&apos;s standard type. Override only
        the farms that genuinely differ — e.g. a mature orchard inside a project whose default is
        young orchard.
      </p>

      <div className="mt-3 space-y-2">
        {farms.map((f) => (
          <div key={f.farmId} className="flex items-center justify-between gap-3 border-b border-line/60 pb-2 last:border-0">
            <div>
              <span className="text-[13px] font-semibold text-pine-700">{f.farmName}</span>
              <span className="ml-2 font-mono text-[11px] text-faint">
                project default: {f.projectDefault ? (PLOT_TYPE_LABELS[f.projectDefault] ?? f.projectDefault) : "none"}
              </span>
            </div>
            <select
              value={values[f.farmId] ?? ""}
              onChange={(e) => {
                setValues((v) => ({ ...v, [f.farmId]: e.target.value }));
                setMsg(null);
              }}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-pine-700"
            >
              <option value="">Use project default</option>
              <option value="open_field">Open field</option>
              <option value="young_orchard">Young orchard</option>
              <option value="mature_orchard">Mature orchard</option>
            </select>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              for (const f of farms) {
                const value = values[f.farmId] || null;
                if (value === (f.override ?? null)) continue;
                const result = await save(f.farmId, value);
                if (!result.ok) {
                  setMsg({ ok: false, text: result.error ?? "Could not save." });
                  return;
                }
              }
              setMsg({ ok: true, text: "Saved — the next credit-potential run will use the new plot types." });
            })
          }
          className="rounded-lg bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save plot types"}
        </button>
        {msg && <span className={`text-[12.5px] ${msg.ok ? "text-sage-700" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
