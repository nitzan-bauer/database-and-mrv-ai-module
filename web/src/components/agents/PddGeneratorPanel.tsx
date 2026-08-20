"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ToolResult } from "@/lib/tools/context";
import type { PddGeneratorPipelineResult } from "@/lib/tools/runPddGeneratorPipeline";

/**
 * "PDD GENERATOR" — Nitzan's own spec, live this session: research
 * (local precedent + live Verra registry), Rebeka actually drafting
 * every chapter, the live PDD Doc, a PDF export, an email to Nitzan,
 * and a memory write — in one run, inactive until every section of the
 * questionnaire above is answered or skipped. Runs for real minutes
 * (research alone can take 10-60s per source), so this shows the
 * honest wait-time up front rather than a spinner that looks hung, and
 * a full itemized breakdown once it returns — not live step-by-step
 * progress, which would need a streaming mechanism this app doesn't
 * have yet.
 *
 * One-time: once it succeeds, the questionnaire above becomes view-only
 * (mrv.projects.pdd_generator_locked_at) — this panel doesn't run
 * again for the same project, by design.
 */
export function PddGeneratorPanel({
  projectId,
  pendingCount,
  lockedAt,
  action,
}: {
  projectId: string;
  pendingCount: number;
  lockedAt: string | null;
  action: (input: { projectId: string }) => Promise<ToolResult<PddGeneratorPipelineResult>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<PddGeneratorPipelineResult> | null>(null);

  function run() {
    start(async () => {
      const res = await action({ projectId });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (lockedAt) {
    return (
      <div className="mb-4 rounded-xl border-2 border-sage-300 bg-sage-50/40 p-4">
        <h3 className="text-[14px] font-bold text-pine-700">PDD Generator</h3>
        <p className="mt-1 text-[12px] text-sage-700">
          Ran on {new Date(lockedAt).toLocaleString()} — the questionnaire above is now view-only.
        </p>
      </div>
    );
  }

  const disabled = pending || pendingCount > 0;

  return (
    <div className="mb-4 rounded-xl border-2 border-pine-300 bg-pine-50/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-pine-700">PDD Generator</h3>
          <p className="mt-1 max-w-2xl text-[11.5px] text-faint">
            Research, Rebeka drafting every chapter, the live PDD Doc, a PDF export, and an email to you
            — in one run. Takes a few minutes. Locks this questionnaire once it succeeds — you won&apos;t
            be able to edit it again, only view it.
          </p>
          {pendingCount > 0 && (
            <p className="mt-1 text-[11.5px] font-semibold text-earth-600">
              {pendingCount} section{pendingCount === 1 ? "" : "s"} still pending above — answer or skip
              everything to enable this.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={disabled}
          className="shrink-0 rounded-lg bg-pine-700 px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-pine-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Running… (a few minutes)" : "Run PDD Generator"}
        </button>
      </div>

      {result && !result.ok && <p className="mt-3 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <div className="mt-3 space-y-1 rounded-lg border border-line bg-white p-3">
          {result.data.steps.map((s, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[12px]">
              <span className={s.ok ? "text-sage-700" : "text-danger"}>{s.ok ? "✓" : "✗"}</span>
              <span className="font-mono text-[11px] text-pine-700">{s.step}</span>
              <span className="text-faint">{s.detail}</span>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-3 border-t border-line pt-2">
            {result.data.pddDocUrl && (
              <a href={result.data.pddDocUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-sage-700 hover:underline">
                PDD Doc ↗
              </a>
            )}
            {result.data.emailedTo && (
              <span className="text-[12px] text-faint">emailed to {result.data.emailedTo}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
