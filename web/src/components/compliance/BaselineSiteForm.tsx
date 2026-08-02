"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RecordedBaselineSite, SimilarityCriterion } from "@/lib/tools/recordBaselineSite";
import type { ToolResult } from "@/lib/tools/context";

const emptyCriterion: SimilarityCriterion = { name: "", met: true, note: "" };

/**
 * Enter one VM0042 QA2 baseline control site — the same write
 * recordBaselineSite exposes to an agent, called here under the signed-in
 * person's own identity. Area and distance-to-nearest-plot are computed by
 * the server from the geometry, never typed in, so a boundary case cannot
 * be nudged past the 250 km ceiling by hand.
 */
export function BaselineSiteForm({
  farmId,
  plots,
  action,
}: {
  farmId: string;
  plots: Array<{ plotId: string; name: string }>;
  action: (input: {
    farmId: string;
    geometry: string;
    linkedPlotId?: string | null;
    criteria: SimilarityCriterion[];
  }) => Promise<ToolResult<RecordedBaselineSite>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState("");
  const [linkedPlotId, setLinkedPlotId] = useState("");
  const [criteria, setCriteria] = useState<SimilarityCriterion[]>([{ ...emptyCriterion }]);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<RecordedBaselineSite> | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-pine-700 transition-colors hover:bg-pine-50"
      >
        + Record baseline control site
      </button>
    );
  }

  const cleanCriteria = criteria.filter((c) => c.name.trim());
  const canSubmit = geometry.trim() && cleanCriteria.length > 0 && !pending;

  function submit() {
    start(async () => {
      const res = await action({
        farmId,
        geometry: geometry.trim(),
        linkedPlotId: linkedPlotId || null,
        criteria: cleanCriteria,
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-pine-700">Record baseline control site</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11.5px] text-faint hover:text-pine-700"
        >
          close
        </button>
      </div>

      <label className="mt-3 block text-[11px] text-muted">
        Boundary — GeoJSON Polygon or WKT
        <textarea
          value={geometry}
          onChange={(e) => setGeometry(e.target.value)}
          placeholder='{"type":"Polygon","coordinates":[[[...]]]}  or  POLYGON((...))'
          rows={3}
          className="mt-1 w-full rounded-lg border border-line bg-white p-2 font-mono text-[11.5px]"
        />
      </label>
      <p className="mt-1 text-[11px] text-faint">
        Area and the distance to this farm&apos;s nearest plot are computed from the boundary, not
        entered here.
      </p>

      <label className="mt-3 block text-[11px] text-muted">
        Control for plot (optional)
        <select
          value={linkedPlotId}
          onChange={(e) => setLinkedPlotId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
        >
          <option value="">— none —</option>
          {plots.map((p) => (
            <option key={p.plotId} value={p.plotId}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3">
        <p className="text-[11px] font-semibold text-muted">
          VM0042 Table 7 similarity criteria assessed
        </p>
        <div className="mt-1 space-y-1.5">
          {criteria.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="criterion name"
                value={c.name}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i], name: e.target.value };
                  setCriteria(next);
                }}
                className="flex-1 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              />
              <label className="flex items-center gap-1 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={c.met}
                  onChange={(e) => {
                    const next = [...criteria];
                    next[i] = { ...next[i], met: e.target.checked };
                    setCriteria(next);
                  }}
                />
                met
              </label>
              <input
                type="text"
                placeholder="note (optional)"
                value={c.note ?? ""}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i], note: e.target.value };
                  setCriteria(next);
                }}
                className="w-32 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              />
              <button
                type="button"
                onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                className="text-[11px] text-faint hover:text-danger"
              >
                remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCriteria([...criteria, { ...emptyCriterion }])}
          className="mt-1.5 text-[11.5px] font-semibold text-pine-700 hover:underline"
        >
          + add criterion
        </button>
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="mt-3 rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>

      {result && !result.ok && <p className="mt-2 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <p className="mt-2 text-[12px] text-sage-700">
          Saved {result.data.bslId} — {result.data.areaHa.toFixed(2)} ha,{" "}
          {result.data.distanceKm.toFixed(1)} km from the nearest plot,{" "}
          {result.data.criteriaMet}/{result.data.criteriaTotal} criteria met.
        </p>
      )}
    </div>
  );
}
