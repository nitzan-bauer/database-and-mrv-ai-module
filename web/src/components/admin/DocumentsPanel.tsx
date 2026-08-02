"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DriveFile } from "@/lib/google/driveClient";
import type { LinkedDriveFolder } from "@/lib/tools/linkFarmDriveFolder";
import type { CentralizedDocument, CentralizeSource } from "@/lib/tools/centralizeFarmDocument";
import type { ToolResult } from "@/lib/tools/context";

/**
 * Jennifer's document_centralisation skill, per farm — link the real Drive
 * folder the team already uses, see what's really in it, and push this
 * farm's own KMZ or a generated PDD draft into it. Every call runs as the
 * signed-in person's own Google session.
 */
export function DocumentsPanel({
  farmId,
  farmName,
  driveFolderId,
  pddDraftOptions,
  linkAction,
  listAction,
  centralizeAction,
}: {
  farmId: string;
  farmName: string;
  driveFolderId: string | null;
  pddDraftOptions: Array<{ draftId: string; label: string }>;
  linkAction: (input: { farmId: string; driveFolderId: string }) => Promise<ToolResult<LinkedDriveFolder>>;
  listAction: (input: { farmId: string }) => Promise<ToolResult<DriveFile[]>>;
  centralizeAction: (input: { farmId: string; source: CentralizeSource }) => Promise<ToolResult<CentralizedDocument>>;
}) {
  const router = useRouter();
  const [folderIdInput, setFolderIdInput] = useState("");
  const [pending, start] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState("");

  function link() {
    start(async () => {
      setLinkError(null);
      const res = await linkAction({ farmId, driveFolderId: folderIdInput.trim() });
      if (!res.ok) setLinkError(res.error);
      else router.refresh();
    });
  }

  function loadFiles() {
    start(async () => {
      setListError(null);
      const res = await listAction({ farmId });
      if (!res.ok) setListError(res.error);
      else setFiles(res.data);
    });
  }

  function push(source: CentralizeSource) {
    start(async () => {
      setPushMessage(null);
      const res = await centralizeAction({ farmId, source });
      setPushMessage(res.ok ? `Uploaded ${res.data.file.name}.` : res.error);
      if (res.ok) loadFiles();
    });
  }

  if (!driveFolderId) {
    return (
      <div className="rounded-xl border border-line bg-white p-4">
        <h3 className="text-[13px] font-bold text-pine-700">{farmName} — Drive folder</h3>
        <p className="mt-1 text-[11.5px] text-faint">
          Not linked yet. Open the farm&apos;s existing folder in Drive and paste its id from the URL
          (the part after <span className="font-mono">/folders/</span>).
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Drive folder id"
            value={folderIdInput}
            onChange={(e) => setFolderIdInput(e.target.value)}
            className="flex-1 rounded-lg border border-line bg-white p-1.5 font-mono text-[12px]"
          />
          <button
            type="button"
            disabled={!folderIdInput.trim() || pending}
            onClick={link}
            className="rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Linking…" : "Link"}
          </button>
        </div>
        {linkError && <p className="mt-2 text-[12px] text-danger">{linkError}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-pine-700">{farmName} — Drive documents</h3>
        <button
          type="button"
          onClick={loadFiles}
          disabled={pending}
          className="text-[11.5px] font-semibold text-pine-700 hover:underline disabled:opacity-40"
        >
          {files ? "refresh" : "load"}
        </button>
      </div>
      <p className="mt-1 font-mono text-[10.5px] text-faint">folder: {driveFolderId}</p>

      {listError && <p className="mt-2 text-[12px] text-danger">{listError}</p>}
      {files && (
        <div className="mt-2 space-y-1">
          {files.length === 0 ? (
            <p className="text-[11.5px] text-faint">Empty.</p>
          ) : (
            files.map((f) => (
              <a
                key={f.id}
                href={f.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="block truncate rounded-lg border border-line px-2 py-1 text-[12px] text-pine-700 hover:bg-cream"
              >
                {f.name}
              </a>
            ))
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => push({ type: "kmz" })}
          disabled={pending}
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-pine-700 hover:bg-pine-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Push KMZ
        </button>
        {pddDraftOptions.length > 0 && (
          <>
            <select
              value={selectedDraft}
              onChange={(e) => setSelectedDraft(e.target.value)}
              className="rounded-lg border border-line bg-white p-1.5 text-[11.5px]"
            >
              <option value="">— PDD draft —</option>
              {pddDraftOptions.map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {d.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedDraft || pending}
              onClick={() => push({ type: "pdd_draft", draftId: selectedDraft })}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-pine-700 hover:bg-pine-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Push draft
            </button>
          </>
        )}
      </div>
      {pushMessage && <p className="mt-2 text-[12px] text-sage-700">{pushMessage}</p>}
    </div>
  );
}
