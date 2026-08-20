"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ToolResult } from "@/lib/tools/context";
import type { CompiledEligibilityPack } from "@/lib/tools/compileEligibilityEvidencePack";

/** Every real project activity, linked to its VM0042 Appendix 1 category — a Google Doc in the project's Drive folder. */
export function EligibilityPackPanel({
  projectId,
  packDocUrl,
  action,
}: {
  projectId: string;
  packDocUrl: string | null;
  action: (input: { projectId: string }) => Promise<ToolResult<CompiledEligibilityPack>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<CompiledEligibilityPack> | null>(null);

  function sync() {
    start(async () => {
      const res = await action({ projectId });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  const link = result?.ok ? result.data.packDocUrl : packDocUrl;

  return (
    <div className="mb-4 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-pine-700">Eligibility Evidence Pack</h3>
          <p className="mt-1 text-[11.5px] text-faint">
            A Google Doc, in the project&apos;s Drive folder — every recorded project activity linked to its
            VM0042 v2.2 Appendix 1 category and bullet (eligibility + additionality evidence).
          </p>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="shrink-0 rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Compiling…" : link ? "Update pack" : "Compile pack"}
        </button>
      </div>
      {result && !result.ok && <p className="mt-2 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <p className="mt-2 text-[12px] text-sage-700">
          {result.data.created ? "Created" : "Updated"} — {result.data.activityGroups.length} activity type
          {result.data.activityGroups.length === 1 ? "" : "s"}
          {result.data.unmatchedCount > 0 && `, ${result.data.unmatchedCount} needing a manual citation`}.
        </p>
      )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-md border border-sage-300 px-2 py-1 text-[12px] font-semibold text-sage-700 hover:bg-sage-50"
        >
          Open pack ↗
        </a>
      )}
    </div>
  );
}
