"use client";

import { useState, useTransition } from "react";

export interface CropCycleLength {
  cropName: string;
  cycleDays: number;
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * Ron's crop-cycle-length lookup (mrv.crop_cycle_lengths) — super_admin
 * only. Nitzan fills this in by hand, once per crop; ron_crop_cycle_reminder
 * reads it to know when an open-field crop's season is ending. A crop not
 * listed here is reported as skipped by that task rather than guessed at.
 */
export function CropCycleLengthsPanel({
  crops,
  save,
}: {
  crops: CropCycleLength[];
  save: (cropName: string, cycleDays: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [rows, setRows] = useState(crops);
  const [newCrop, setNewCrop] = useState("");
  const [newDays, setNewDays] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function updateRowDays(cropName: string, value: string) {
    setRows((rs) => rs.map((r) => (r.cropName === cropName ? { ...r, cycleDays: Number(value) || 0 } : r)));
  }

  function saveRow(cropName: string, cycleDays: number) {
    start(async () => {
      if (!(cycleDays > 0)) {
        setMsg({ ok: false, text: "Cycle length must be a positive number of days." });
        return;
      }
      const result = await save(cropName, cycleDays);
      setMsg(
        result.ok
          ? { ok: true, text: `Saved — ${cropName}: ${cycleDays} days.` }
          : { ok: false, text: result.error ?? "Could not save." },
      );
    });
  }

  function addCrop() {
    start(async () => {
      const name = newCrop.trim();
      const days = Number(newDays);
      if (!name) { setMsg({ ok: false, text: "Crop name is required." }); return; }
      if (!(days > 0)) { setMsg({ ok: false, text: "Cycle length must be a positive number of days." }); return; }
      const result = await save(name, days);
      if (result.ok) {
        setRows((rs) => [...rs.filter((r) => r.cropName.toLowerCase() !== name.toLowerCase()), { cropName: name.toLowerCase(), cycleDays: days, updatedBy: null, updatedAt: new Date().toISOString() }]);
        setNewCrop("");
        setNewDays("");
        setMsg({ ok: true, text: `Added ${name}: ${days} days.` });
      } else {
        setMsg({ ok: false, text: result.error ?? "Could not save." });
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-bold text-pine-700">Crop cycle lengths (days)</h3>
      <p className="mt-1 text-[12.5px] text-muted">
        Drives the open-field crop-cycle reminder — a crop not listed here is skipped, never guessed at. Matched
        against the plot&apos;s own crop field, case-insensitive.
      </p>

      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.cropName} className="flex items-center gap-2">
              <span className="w-40 truncate text-sm text-pine-700">{r.cropName}</span>
              <input
                type="number"
                min="1"
                value={r.cycleDays}
                onChange={(e) => updateRowDays(r.cropName, e.target.value)}
                className="w-24 rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-pine-700"
              />
              <span className="text-[11px] text-faint">days</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => saveRow(r.cropName, r.cycleDays)}
                className="rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-pine-700 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <input
          value={newCrop}
          onChange={(e) => setNewCrop(e.target.value)}
          placeholder="Crop name (e.g. tomato)"
          className="w-40 rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
        />
        <input
          type="number"
          min="1"
          value={newDays}
          onChange={(e) => setNewDays(e.target.value)}
          placeholder="days"
          className="w-24 rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={pending}
          onClick={addCrop}
          className="rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-pine-700 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Add crop"}
        </button>
      </div>
      {msg && <p className={`mt-2 text-[12.5px] ${msg.ok ? "text-sage-700" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
