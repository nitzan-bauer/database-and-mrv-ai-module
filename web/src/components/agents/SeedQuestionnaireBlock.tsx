"use client";

import { useState, useTransition } from "react";
import type { ToolResult } from "@/lib/tools/context";
import type { SeedAnswerRow, SeedAutoFact } from "@/lib/pdd/seedAnswers";
import type { UpdatedPddSeedAnswer } from "@/lib/tools/updatePddSeedAnswer";
import { PddGeneratorPanel } from "./PddGeneratorPanel";
import type { PddGeneratorPipelineResult } from "@/lib/tools/runPddGeneratorPipeline";

type SaveAnswerAction = (input: { projectId: string; questionKey: string; answerText: string }) => Promise<ToolResult<UpdatedPddSeedAnswer>>;
type RunGeneratorAction = (input: { projectId: string }) => Promise<ToolResult<PddGeneratorPipelineResult>>;

function OneAnswer({
  projectId,
  row,
  readOnly,
  action,
}: {
  projectId: string;
  row: SeedAnswerRow;
  readOnly: boolean;
  action: SaveAnswerAction;
}) {
  const [text, setText] = useState(row.answerText ?? "");
  const [status, setStatus] = useState(row.status);
  const [saved, setSaved] = useState(true);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await action({ projectId, questionKey: row.questionKey, answerText: text });
      if (res.ok) setStatus(res.data.status);
      setSaved(true);
    });
  }

  return (
    <div className="border-t border-line py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-pine-700">{row.label}</span>
        <span
          className={
            "ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] " +
            (status === "answered" ? "bg-sage-100 text-sage-700" : "bg-cream text-faint")
          }
        >
          {pending ? "saving…" : status}
        </span>
      </div>
      {row.hint && <p className="mt-0.5 text-[11px] italic text-muted">{row.hint}</p>}
      {row.externalNote ? (
        <p className="mt-1 rounded-md border border-line bg-cream/40 p-1.5 text-[11.5px] text-earth-700">{row.externalNote}</p>
      ) : (
        <textarea
          value={text}
          readOnly={readOnly}
          onChange={(e) => {
            if (readOnly) return;
            setText(e.target.value);
            setSaved(false);
          }}
          onBlur={() => {
            if (!readOnly && !saved) save();
          }}
          placeholder="Your answer…"
          rows={1}
          className={"mt-1 w-full rounded-md border border-line p-1.5 text-[12px] " + (readOnly ? "cursor-default bg-cream/40 opacity-70" : "bg-white")}
        />
      )}
    </div>
  );
}

/**
 * The SEED questionnaire — Nitzan's own re-spec, rebuilt from scratch
 * (live this session): a small, fixed intake form, deliberately NOT
 * aligned to the VCS template's own sections (that's PDD Development's
 * job). Lives as a collapsed block on Rebeka's own page, not a separate
 * route — its title starts generic and becomes "PDD Questionnaire for
 * '<project name>'" the moment that question gets an answer.
 */
export function SeedQuestionnaireBlock({
  projectId,
  projectName,
  rows,
  autoFacts,
  pendingCount,
  lockedAt,
  defaultOpen = false,
  saveAnswerAction,
  runGeneratorAction,
}: {
  projectId: string;
  projectName: string | null;
  rows: SeedAnswerRow[];
  autoFacts: SeedAutoFact[];
  pendingCount: number;
  lockedAt: string | null;
  defaultOpen?: boolean;
  saveAnswerAction: SaveAnswerAction;
  runGeneratorAction: RunGeneratorAction;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const readOnly = Boolean(lockedAt);
  const title = projectName ? `PDD Questionnaire for "${projectName}"` : "PDD Questionnaire";

  return (
    <div className="rounded-xl border-2 border-pine-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl bg-pine-50/60 px-4 py-3 text-left hover:bg-pine-50"
      >
        <span className="text-[14px] font-bold text-pine-700">{title}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-faint">
            {rows.length - pendingCount}/{rows.length} answered
          </span>
          <span className="text-[15px] text-pine-600">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-3">
          <div className="rounded-lg border border-line bg-cream/40 p-2">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
              Rebeka already has these — not asked
            </p>
            <div className="space-y-1">
              {autoFacts.map((f) => (
                <p key={f.label} className="text-[12px] text-pine-700">
                  <span className="font-semibold">{f.label}:</span> {f.value}
                </p>
              ))}
            </div>
          </div>

          <div>
            {rows.map((row) => (
              <OneAnswer key={row.questionKey} projectId={projectId} row={row} readOnly={readOnly} action={saveAnswerAction} />
            ))}
          </div>

          <PddGeneratorPanel projectId={projectId} pendingCount={pendingCount} lockedAt={lockedAt} action={runGeneratorAction} />
        </div>
      )}
    </div>
  );
}
