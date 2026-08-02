"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RecordedAdditionality, Barrier } from "@/lib/tools/recordAdditionalityAssessment";
import type { ToolResult } from "@/lib/tools/context";

const emptyBarrier: Barrier = { name: "", description: "" };

/**
 * Record a VM0042 v2.2 §7 additionality assessment — the methodology's own
 * three steps (regulatory surplus, barrier analysis, common practice),
 * run under the signed-in person's own identity.
 */
export function AdditionalityForm({
  projectId,
  action,
}: {
  projectId: string;
  action: (input: {
    projectId: string;
    regulatorySurplusMet: boolean;
    regulatorySurplusNote: string;
    barriers: Barrier[];
    commonPracticeRegion: string;
    commonPracticeAdoptionPct: number | null;
    step4cDemonstrated?: boolean;
    step4cNote?: string;
  }) => Promise<ToolResult<RecordedAdditionality>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [regulatorySurplusMet, setRegulatorySurplusMet] = useState(true);
  const [regulatorySurplusNote, setRegulatorySurplusNote] = useState("");
  const [barriers, setBarriers] = useState<Barrier[]>([{ ...emptyBarrier }]);
  const [commonPracticeRegion, setCommonPracticeRegion] = useState("");
  const [adoptionPct, setAdoptionPct] = useState("");
  const [step4cDemonstrated, setStep4cDemonstrated] = useState(false);
  const [step4cNote, setStep4cNote] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<RecordedAdditionality> | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-pine-700 transition-colors hover:bg-pine-50"
      >
        + Record additionality assessment
      </button>
    );
  }

  const cleanBarriers = barriers.filter((b) => b.name.trim());
  const canSubmit = regulatorySurplusNote.trim() && commonPracticeRegion.trim() && !pending;
  const adoptionNum = adoptionPct.trim() ? Number(adoptionPct) : null;
  const needsStep4c = adoptionNum == null || adoptionNum >= 20;

  function submit() {
    start(async () => {
      const res = await action({
        projectId,
        regulatorySurplusMet,
        regulatorySurplusNote: regulatorySurplusNote.trim(),
        barriers: cleanBarriers,
        commonPracticeRegion: commonPracticeRegion.trim(),
        commonPracticeAdoptionPct: adoptionNum,
        step4cDemonstrated: needsStep4c ? step4cDemonstrated : undefined,
        step4cNote: needsStep4c && step4cNote.trim() ? step4cNote.trim() : undefined,
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-pine-700">Additionality assessment (VM0042 §7)</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-[11.5px] text-faint hover:text-pine-700">
          close
        </button>
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-semibold text-muted">Step 1 — Regulatory surplus</p>
        <label className="mt-1 flex items-center gap-1.5 text-[12px] text-pine-700">
          <input type="checkbox" checked={regulatorySurplusMet} onChange={(e) => setRegulatorySurplusMet(e.target.checked)} />
          Demonstrated
        </label>
        <textarea
          value={regulatorySurplusNote}
          onChange={(e) => setRegulatorySurplusNote(e.target.value)}
          placeholder="Evidence — which VCS Standard rule was checked and how."
          rows={2}
          className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-[12.5px]"
        />
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold text-muted">Step 2 — Barrier analysis (VT0008)</p>
        <div className="mt-1 space-y-1.5">
          {barriers.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="barrier name"
                value={b.name}
                onChange={(e) => {
                  const next = [...barriers];
                  next[i] = { ...next[i], name: e.target.value };
                  setBarriers(next);
                }}
                className="w-40 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              />
              <input
                type="text"
                placeholder="description"
                value={b.description}
                onChange={(e) => {
                  const next = [...barriers];
                  next[i] = { ...next[i], description: e.target.value };
                  setBarriers(next);
                }}
                className="flex-1 rounded-lg border border-line bg-white p-1.5 text-[12px]"
              />
              <button type="button" onClick={() => setBarriers(barriers.filter((_, j) => j !== i))} className="text-[11px] text-faint hover:text-danger">
                remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setBarriers([...barriers, { ...emptyBarrier }])}
          className="mt-1.5 text-[11.5px] font-semibold text-pine-700 hover:underline"
        >
          + add barrier
        </button>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold text-muted">Step 3 — Common practice (&lt;20% adoption passes on its own)</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="region"
            value={commonPracticeRegion}
            onChange={(e) => setCommonPracticeRegion(e.target.value)}
            className="rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            placeholder="adoption % (leave blank if unknown)"
            value={adoptionPct}
            onChange={(e) => setAdoptionPct(e.target.value)}
            className="rounded-lg border border-line bg-white p-1.5 text-[12.5px]"
          />
        </div>
        {needsStep4c && (
          <div className="mt-2 rounded-lg border border-earth-300 bg-cream px-3 py-2">
            <p className="text-[11.5px] text-earth-600">
              {adoptionNum == null ? "Adoption rate unknown" : `Adoption ${adoptionNum}% is at or above 20%`} — Step 4c of
              VT0008 must be separately demonstrated for common practice to pass.
            </p>
            <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-pine-700">
              <input type="checkbox" checked={step4cDemonstrated} onChange={(e) => setStep4cDemonstrated(e.target.checked)} />
              Step 4c demonstrated
            </label>
            <textarea
              value={step4cNote}
              onChange={(e) => setStep4cNote(e.target.value)}
              placeholder="Step 4c evidence, if demonstrated."
              rows={2}
              className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-[12px]"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="mt-4 rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>

      {result && !result.ok && <p className="mt-2 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <p className={"mt-2 text-[12px] " + (result.data.overallMet ? "text-sage-700" : "text-earth-600")}>
          Saved — {result.data.overallMet ? "additionality demonstrated" : "not yet demonstrated"} ·{" "}
          regulatory surplus {result.data.regulatorySurplusMet ? "met" : "not met"} · {result.data.barrierCount} barrier(s) ·
          common practice {result.data.commonPracticeMet ? "passes" : "does not pass"}.
        </p>
      )}
    </div>
  );
}
