"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ToolResult } from "@/lib/tools/context";
import type { SyncedPddGoogleDoc } from "@/lib/tools/syncPddGoogleDoc";

/**
 * The live PDD document — a real Google Doc, not the read-only preview
 * PddDraftPanel shows. First click creates it; every click after that
 * overwrites its content with the current state of mrv (one-directional:
 * edits typed into the Doc itself are not read back out — see
 * syncPddGoogleDoc.ts for why).
 */
export function GoogleDocPanel({
  projectId,
  googleDocUrl,
  action,
}: {
  projectId: string;
  googleDocUrl: string | null;
  action: (input: { projectId: string }) => Promise<ToolResult<SyncedPddGoogleDoc>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ToolResult<SyncedPddGoogleDoc> | null>(null);

  function sync() {
    start(async () => {
      const res = await action({ projectId });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  const link = result?.ok ? result.data.googleDocUrl : googleDocUrl;

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-pine-700">Live PDD document</h3>
          <p className="mt-1 text-[11.5px] text-faint">
            A real, editable Google Doc — not the read-only preview below. Regenerating overwrites its
            content with the current state of the database; edits typed directly into the Doc are not
            read back into mrv.
          </p>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="shrink-0 rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Syncing…" : link ? "Update Google Doc" : "Create Google Doc"}
        </button>
      </div>

      {result && !result.ok && <p className="mt-2 text-[12px] text-danger">{result.error}</p>}
      {result?.ok && (
        <p className="mt-2 text-[12px] text-sage-700">
          {result.data.created ? "Created" : "Updated"} — {result.data.sectionsFilled}/{result.data.sectionsTotal}{" "}
          sections carry template guidance text.
        </p>
      )}

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-md border border-sage-300 px-2 py-1 text-[12px] font-semibold text-sage-700 hover:bg-sage-50"
        >
          Open in Google Docs ↗
        </a>
      )}
    </div>
  );
}
