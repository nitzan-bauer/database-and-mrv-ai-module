"use client";

import { useState, useTransition } from "react";
import type { ToolResult } from "@/lib/tools/context";
import type { UpdatedPddSectionStatus } from "@/lib/tools/updatePddSectionStatus";

type UpdateAction = (input: {
  projectId: string;
  templateId: string;
  sectionIndex: number;
  status?: "pending" | "answered" | "skipped";
  inputText?: string;
  reviewComment?: string;
  devApproved?: boolean;
}) => Promise<ToolResult<UpdatedPddSectionStatus>>;

/** One real row of the Estimated GHG Emission Reductions and Removals table — same shape getGhgReductionRows returns. */
export interface GhgTableRowView {
  startDisplay: string;
  endDisplay: string;
  totalTco2e: number;
  extrapolated: boolean;
}

/**
 * One section's review card — Nitzan's own 4-window spec: Rebeka's
 * answer + what she's still missing on top, Nitzan's comments and his
 * answers to the missing inputs underneath. A section is "closed" only
 * when both halves of the spec's 2-condition rule are true: Nitzan
 * clicked Approved, AND nothing is still missing from the drafted
 * answer (extractNeedsMarkers empty) — "Rebeka confirms she received
 * everything" is read directly off the current draft rather than a
 * second manual toggle a person could forget to click.
 */
export function DevelopmentSectionCard({
  projectId,
  templateId,
  sectionIndex,
  sectionNumber,
  sectionTitle,
  guidance,
  draftedText,
  inputText: initialInputText,
  missingInputs,
  reviewComment: initialReviewComment,
  devApproved: initialDevApproved,
  ghgTable,
  action,
}: {
  projectId: string;
  templateId: string;
  sectionIndex: number;
  sectionNumber?: string;
  sectionTitle: string;
  /** Verra's own guidance/question text for this section, verbatim from the registered template. */
  guidance?: string | null;
  draftedText: string | null;
  inputText: string | null;
  missingInputs: string[];
  reviewComment: string | null;
  devApproved: boolean;
  /**
   * Real rows from mrv.ghg_reduction_estimates (same source and same
   * shape the actual docx table is built from) — when set, Rebeka's
   * answer renders as a real table instead of drafted_text prose. This
   * table is never something Rebeka wrote: it's read the same way
   * fillGhgReductionsTable reads it for the live document, so what's
   * shown here and what ends up in the PDD can never drift apart.
   */
  ghgTable?: GhgTableRowView[];
  action: UpdateAction;
}) {
  const [inputText, setInputText] = useState(initialInputText ?? "");
  const [reviewComment, setReviewComment] = useState(initialReviewComment ?? "");
  const [devApproved, setDevApproved] = useState(initialDevApproved);
  const [savedInput, setSavedInput] = useState(true);
  const [savedComment, setSavedComment] = useState(true);
  const [pending, start] = useTransition();

  const closed = devApproved && missingInputs.length === 0;

  function saveInputText() {
    start(async () => {
      await action({ projectId, templateId, sectionIndex, status: "answered", inputText });
      setSavedInput(true);
    });
  }
  function saveReviewComment() {
    start(async () => {
      await action({ projectId, templateId, sectionIndex, reviewComment });
      setSavedComment(true);
    });
  }
  function toggleApproved() {
    const next = !devApproved;
    start(async () => {
      await action({ projectId, templateId, sectionIndex, devApproved: next });
      setDevApproved(next);
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[13px] font-bold text-pine-700">
          {sectionNumber && <span className="mr-1.5 font-mono text-faint">{sectionNumber}</span>}
          {sectionTitle}
        </h4>
        <div className="flex items-center gap-2">
          <span
            className={
              "rounded-full px-2 py-0.5 font-mono text-[10px] " +
              (closed ? "bg-sage-100 text-sage-700" : "bg-cream text-faint")
            }
          >
            {closed ? "closed" : "open"}
          </span>
          <button
            type="button"
            onClick={toggleApproved}
            disabled={pending}
            className={
              "shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 " +
              (devApproved
                ? "border-sage-300 bg-sage-50 text-sage-700 hover:bg-sage-100"
                : "border-line text-muted hover:bg-cream")
            }
          >
            {devApproved ? "✓ Approved" : "Approve"}
          </button>
        </div>
      </div>
      {guidance && <p className="mb-2 whitespace-pre-wrap text-[11.5px] italic text-muted">{guidance}</p>}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {/* Row 1, Window A — Rebeka's answer (or the real table, for table-shaped sections) */}
        <div className="rounded-md border border-line bg-cream/40 p-2">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
            Rebeka&apos;s answer{ghgTable && " — real data, not written by Rebeka"}
          </p>
          {ghgTable ? (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="pr-2 font-semibold">Vintage start</th>
                    <th className="pr-2 font-semibold">Vintage end</th>
                    <th className="pr-2 font-semibold">Net reductions+removals (tCO2e)</th>
                    <th className="font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {ghgTable.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-0.5 pr-2 text-pine-700">{r.startDisplay}</td>
                      <td className="py-0.5 pr-2 text-pine-700">{r.endDisplay}</td>
                      <td className="py-0.5 pr-2 font-mono text-pine-700">{Math.round(r.totalTco2e).toLocaleString("en-US")}</td>
                      <td className="py-0.5 text-faint">{r.extrapolated ? "extrapolated" : "founder-given"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10.5px] italic text-faint">
                Baseline/project/leakage/net-reduction/net-removal breakdown per year needs a real VM0042 model
                run — not shown until then, never estimated.
              </p>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[12px] text-pine-700">
              {draftedText?.trim() || <span className="italic text-faint">Not drafted yet.</span>}
            </div>
          )}
        </div>

        {/* Row 1, Window B — missing inputs */}
        <div className="rounded-md border border-line bg-cream/40 p-2">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Inputs Rebeka is missing</p>
          {missingInputs.length ? (
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-earth-700">
              {missingInputs.map((need, i) => (
                <li key={i}>{need}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] italic text-sage-700">Nothing outstanding.</p>
          )}
        </div>

        {/* Row 2, Window A — comments/tasks to Rebeka */}
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Your comments / tasks for Rebeka</p>
          <textarea
            value={reviewComment}
            onChange={(e) => {
              setReviewComment(e.target.value);
              setSavedComment(false);
            }}
            onBlur={() => {
              if (!savedComment) saveReviewComment();
            }}
            placeholder="e.g. this is too vague — expand on the monitoring cadence…"
            rows={3}
            className="w-full rounded-md border border-line bg-white p-1.5 text-[12px]"
          />
        </div>

        {/* Row 2, Window B — your answers to the missing inputs */}
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Your answers to the missing inputs</p>
          <textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              setSavedInput(false);
            }}
            onBlur={() => {
              if (!savedInput) saveInputText();
            }}
            placeholder="Fill in what Rebeka is missing, above…"
            rows={3}
            className="w-full rounded-md border border-line bg-white p-1.5 text-[12px]"
          />
        </div>
      </div>
      {pending && <p className="mt-1 text-[10.5px] text-faint">saving…</p>}
    </div>
  );
}
