"use client";

import { useTransition } from "react";
import type { KmzExport } from "@/lib/tools/exportPlotsKmz";
import type { ToolResult } from "@/lib/tools/context";

/**
 * Downloads a KMZ for the active farm's plots — export_plots_kmz run under
 * the signed-in person's own identity. The file travels from the server
 * action as base64 (a ToolResult is JSON, not raw bytes) and is turned
 * back into a Blob only in the browser, right before the download.
 */
export function KmzDownloadButton({
  farmId,
  action,
}: {
  farmId: string;
  action: (input: { farmId: string }) => Promise<ToolResult<KmzExport>>;
}) {
  const [pending, start] = useTransition();

  function download() {
    start(async () => {
      const res = await action({ farmId });
      if (!res.ok) {
        window.alert(res.error);
        return;
      }
      const bytes = Uint8Array.from(atob(res.data.kmzBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/vnd.google-earth.kmz" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.data.fileName;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={pending}
      className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-pine-700 transition-colors hover:bg-pine-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Preparing…" : "Download KMZ"}
    </button>
  );
}
