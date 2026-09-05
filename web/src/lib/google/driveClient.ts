import "server-only";

/**
 * Google Drive v3 REST calls over plain `fetch` — the same choice made for
 * Claude's Messages API (anthropicProvider.ts) and for every document
 * reader in this repo: one small, stable, well-documented HTTP surface
 * does not need an SDK dependency wrapped around it.
 *
 * Every call here runs as the signed-in person's own OAuth token (from
 * auth.ts's Drive scope), never a service identity — so a call can only
 * ever see or change what that person could already see or change by hand
 * in Drive.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
}

async function driveFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
}

/**
 * Every call here passes supportsAllDrives=true. Without it the Drive v3
 * API silently treats a Shared Drive item as not found (404) rather than
 * returning it — a real folder reads as "doesn't exist" purely because of
 * where it lives, which is exactly the kind of failure that looks like a
 * copy-paste mistake and is not.
 */
const ALL_DRIVES = "supportsAllDrives=true";

/** Confirms a folder id is real, reachable, and actually a folder — not a guess about what a person pasted. */
export async function verifyDriveFolder(
  accessToken: string,
  folderId: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const res = await driveFetch(
    accessToken,
    `files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed&${ALL_DRIVES}`,
  );
  if (res.status === 404) return { ok: false, error: "No Drive folder with that id — check it was copied correctly." };
  if (res.status === 401) return { ok: false, error: "Drive access token is invalid or expired — sign out and back in." };
  if (!res.ok) return { ok: false, error: `Drive API error ${res.status}` };
  const data = (await res.json()) as { name: string; mimeType: string; trashed: boolean };
  if (data.mimeType !== "application/vnd.google-apps.folder") {
    return { ok: false, error: `That id is a ${data.mimeType.split(".").pop()}, not a folder.` };
  }
  if (data.trashed) return { ok: false, error: "That folder is in the trash." };
  return { ok: true, name: data.name };
}

/** Real, current contents of a folder — not cached, not assumed. */
export async function listDriveFolderFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    accessToken,
    `files?q=${q}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=name&pageSize=100` +
      `&${ALL_DRIVES}&includeItemsFromAllDrives=true`,
  );
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { files: DriveFile[] };
  return data.files ?? [];
}

/** Uploads one file into a folder via the simple multipart upload path. */
export async function uploadFileToDriveFolder(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  content: Buffer,
): Promise<DriveFile> {
  const boundary = "mrv-boundary-" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`,
      "utf8",
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink&${ALL_DRIVES}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive upload error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as DriveFile;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Create a real Drive folder — the project's own folder, holding its PDD Doc and Readiness Report side by side. */
export async function createDriveFolder(accessToken: string, name: string, parentFolderId?: string): Promise<DriveFile> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink&${ALL_DRIVES}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentFolderId ? { parents: [parentFolderId] } : {}) }),
  });
  if (!res.ok) throw new Error(`Drive create-folder error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as DriveFile;
}

/** Find-or-create a named subfolder under a parent — idempotent by (name, parent), not by any id stored elsewhere. */
export async function ensureSubfolder(accessToken: string, parentFolderId: string, name: string): Promise<string> {
  const existing = await listDriveFolderFiles(accessToken, parentFolderId);
  const match = existing.find((f) => f.name === name && f.mimeType === FOLDER_MIME);
  if (match) return match.id;
  const created = await createDriveFolder(accessToken, name, parentFolderId);
  return created.id;
}

/**
 * Create a real, native Google Doc from a .docx buffer — Drive's own
 * .docx-to-Google-Doc conversion (target mimeType application/vnd.google-
 * apps.document on upload), not a hand-built Docs API document. Real
 * Word heading styles convert into a real Google Docs outline; a Docs
 * API batchUpdate built by hand would have to reimplement that styling
 * logic itself.
 */
export async function createGoogleDocFromDocx(
  accessToken: string,
  fileName: string,
  content: Buffer,
  parentFolderId?: string,
): Promise<DriveFile> {
  const boundary = "mrv-boundary-" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: GOOGLE_DOC_MIME,
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\ncontent-type: ${DOCX_MIME}\r\n\r\n`,
      "utf8",
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink&${ALL_DRIVES}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive create-doc error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as DriveFile;
}

/**
 * Replace an existing Google Doc's content by re-uploading a fresh .docx
 * over it — the same conversion as creation, applied to a file that
 * already exists. This is a full overwrite, not a merge: what "syncing
 * with the database" means in this build is that the database is the
 * source of truth and the Doc reflects it, not that edits typed directly
 * into the Doc are read back out. Deliberate for now; round-tripping
 * human edits back into structured data is a different, larger problem.
 */
export async function updateGoogleDocFromDocx(accessToken: string, fileId: string, content: Buffer): Promise<DriveFile> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}` +
      `?uploadType=media&fields=id,name,mimeType,modifiedTime,webViewLink&${ALL_DRIVES}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": DOCX_MIME },
      body: new Uint8Array(content),
    },
  );
  if (!res.ok) throw new Error(`Drive update-doc error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as DriveFile;
}

/** Raw bytes of a real (non-Google-native) file already sitting in Drive — a downloaded related PDD, not a Doc. */
export async function downloadDriveFile(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await driveFetch(accessToken, `files/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`);
  if (!res.ok) throw new Error(`Drive download error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Export a native Google Doc as plain text — Drive's own conversion.
 * Used for reading a Doc's real content (Stage 10's agent digestion)
 * without a PDF-parsing dependency; a non-Google-Doc file (an uploaded
 * PDF/docx) isn't read this way — its name/type alone still gets noted.
 */
export async function exportGoogleDocAsText(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive export-text error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

/** Export a native Google Doc as a real PDF — Drive's own conversion, not a docx-to-PDF library. */
export async function exportGoogleDocAsPdf(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive export-pdf error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * A Drive shortcut — the same file appearing in another folder without
 * duplicating it. This is what lets one document (e.g. a research brief
 * relevant to both Rebeka and Dave) live in multiple agents' folders
 * without multiplying storage or drifting into two separately-edited
 * copies (Stage 10 of the agent learning-layer plan).
 */
export async function createDriveShortcut(accessToken: string, targetFileId: string, name: string, parentFolderId: string): Promise<DriveFile> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink&${ALL_DRIVES}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.shortcut",
      parents: [parentFolderId],
      shortcutDetails: { targetId: targetFileId },
    }),
  });
  if (!res.ok) throw new Error(`Drive create-shortcut error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as DriveFile;
}

/** Grant "anyone with the link can comment" — what a VVB needs without a Drive account of their own. */
export async function shareGoogleDocForComments(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${ALL_DRIVES}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "anyone", role: "commenter" }),
    },
  );
  if (!res.ok) throw new Error(`Drive share error ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
