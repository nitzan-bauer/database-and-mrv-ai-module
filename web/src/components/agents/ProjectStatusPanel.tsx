"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ToolResult } from "@/lib/tools/context";
import type { SubmittedProjectStatus, ProjectStatus } from "@/lib/tools/submitProjectStatus";

const ORDER: ProjectStatus[] = ["under_development", "registered", "validated", "verified"];

/**
 * Rebeka's own prompt claims she "submit[s] under Under Development to
 * register the project" — until this existed, nothing in the codebase
 * ever changed mrv.projects.status past its insert-time default. This is
 * not a call to Verra (there is no public submission API to call); it is
 * an honest, audited record of which VM0042 stage the project's owner has
 * actually declared it at.
 */
export function ProjectStatusPanel({
  projectId,
  currentStatus,
  action,
}: {
  projectId: string;
  currentStatus: string;
  action: (input: { projectId: string; status: ProjectStatus }) => Promise<ToolResult<SubmittedProjectStatus>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<SubmittedProjectStatus> | null>(null);

  const currentIdx = ORDER.indexOf(currentStatus as ProjectStatus);
  const next = currentIdx >= 0 && currentIdx < ORDER.length - 1 ? ORDER[currentIdx + 1] : null;

  function submit() {
    if (!next) return;
    start(async () => {
      const res = await action({ projectId, status: next });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-pine-700">Project status</h3>
          <p className="mt-1 text-[11.5px] text-faint">
            Current: <span className="font-mono text-pine-700">{currentStatus}</span>. Not a call to
            Verra — there is no public submission API; the real filing still happens by hand. This
            records who declared the project at each stage.
          </p>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !next}
          className="shrink-0 rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Submitting…" : next ? `Advance to ${next}` : "Fully verified"}
        </button>
      </div>

      {result && !result.ok && <p className="mt-2 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <p className="mt-2 text-[12px] text-sage-700">
          {result.data.previousStatus} → {result.data.status} recorded.
        </p>
      )}
    </div>
  );
}
