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
