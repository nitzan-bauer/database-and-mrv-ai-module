"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PddDraft } from "@/lib/data/types";
import type { GeneratedPddDraft } from "@/lib/tools/generatePddDraft";
import type { ToolResult } from "@/lib/tools/context";

/**
 * Generate and review a PDD draft — Rebeka's pdd_generator skill, run
 * under the signed-in person's own identity. The draft is the template's
 * own outline plus a verified-facts annex; nothing here pretends a
 * narrative section has been written.
 */
export function PddDraftPanel({
  projectId,
  drafts,
  action,
}: {
  projectId: string;
  drafts: PddDraft[];
  action: (input: { projectId: string }) => Promise<ToolResult<GeneratedPddDraft>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<GeneratedPddDraft> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function generate() {
    start(async () => {
      const res = await action({ projectId });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-pine-700">Generate a PDD draft</h3>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Generating…" : "Generate draft"}
        </button>
      </div>
      <p className="mt-1 text-[11.5px] text-faint">
        The registered template&apos;s own section outline, plus an annex of real, verified project
        facts. Narrative sections are marked as needing a person — nothing is invented.
      </p>

      {result && !result.ok && <p className="mt-2 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <p className="mt-2 text-[12px] text-sage-700">
          Generated — {result.data.sectionsFilled}/{result.data.sectionsTotal} sections carry template
          guidance text.
        </p>
      )}

      {drafts.length > 0 && (
        <div className="mt-3 space-y-2">
          {drafts.map((d) => (
            <div key={d.draftId} className="rounded-lg border border-line bg-cream">
              <button
                type="button"
                onClick={() => setExpanded(expanded === d.draftId ? null : d.draftId)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
              >
                <span className="text-[12px] font-semibold text-pine-700">
                  {d.templateName} {d.templateVersion} — {d.sectionsFilled}/{d.sectionsTotal} sections guided
                </span>
                <span className="font-mono text-[10.5px] text-faint">
                  {new Date(d.generatedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                  {expanded === d.draftId ? "hide" : "show"}
                </span>
              </button>
              {expanded === d.draftId && (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-line p-3 font-mono text-[11px] text-pine-700">
                  {d.content}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
