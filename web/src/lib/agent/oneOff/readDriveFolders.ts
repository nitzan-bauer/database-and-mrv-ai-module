import "server-only";

// A request can name Google Drive folders ("scan the documents in this folder"). The agent has no tool that reads an
// arbitrary folder, so the system reads them when the run starts, with the same Google identity every other Drive
// tool uses, and puts what it found in front of the agent. Whatever it could NOT read is returned as a note the
// agent must repeat — never silently dropped.

const MAX_FILES = 25;
const TOTAL_CHARS = 160_000;
const CONCURRENCY = 5;
const READABLE_EXT = new Set(["txt", "md", "csv", "tsv", "json", "log", "yaml", "yml", "docx", "xlsx", "pdf"]);
const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_DOC = "application/vnd.google-apps.document";

export interface DriveDoc {
  name: string;
  text: string;
  fullChars: number;
}

export interface DriveFolderRead {
  docs: DriveDoc[];
  /** One line per folder (and per problem) — handed to the agent verbatim. */
  notes: string[];
}

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export async function readDriveFolders(accessToken: string | undefined, folderIds: string[]): Promise<DriveFolderRead> {
  const notes: string[] = [];
  if (!folderIds.length) return { docs: [], notes };
  if (!accessToken) {
    return { docs: [], notes: ["No Google access token was available, so no Drive folder could be read."] };
  }

  const { verifyDriveFolder, listDriveFolderFiles, downloadDriveFile, exportGoogleDocAsText } = await import("../../google/driveClient");
  const { extractAttachmentText } = await import("../extractAttachmentText");
  const { allocateBudget } = await import("./jobInput");

  type Candidate = { id: string; name: string; mimeType: string };
  const candidates: Candidate[] = [];
  const skipped: string[] = [];

  for (const folderId of folderIds) {
    const verified = await verifyDriveFolder(accessToken, folderId);
    if (!verified.ok) {
      notes.push(`Folder ${folderId} could not be opened: ${verified.error}`);
      continue;
    }
    let total = 0;
    const walk = async (id: string, depth: number, prefix: string) => {
      const files = await listDriveFolderFiles(accessToken, id);
      for (const f of files) {
        if (f.mimeType === FOLDER) {
          if (depth < 2) await walk(f.id, depth + 1, `${prefix}${f.name}/`);
          continue;
        }
        total++;
        const readable = f.mimeType === GOOGLE_DOC || READABLE_EXT.has(extOf(f.name));
        if (!readable) {
          skipped.push(`${prefix}${f.name}`);
          continue;
        }
        candidates.push({ id: f.id, name: `${prefix}${f.name}`, mimeType: f.mimeType });
      }
    };
    try {
      await walk(folderId, 1, "");
      notes.push(`Folder "${verified.name}": ${total} file(s) found.`);
    } catch (e) {
      notes.push(`Folder "${verified.name}" could not be listed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const chosen = candidates.slice(0, MAX_FILES);
  if (candidates.length > chosen.length) {
    notes.push(`Only the first ${MAX_FILES} of ${candidates.length} readable files were read; the rest were not.`);
  }
  if (skipped.length) {
    notes.push(`Not readable as text (skipped): ${skipped.slice(0, 15).join(", ")}${skipped.length > 15 ? ", …" : ""}.`);
  }

  const docs: DriveDoc[] = [];
  const failed: string[] = [];

  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chosen.length) return;
      const c = chosen[i];
      try {
        let text: string;
        if (c.mimeType === GOOGLE_DOC) {
          text = (await exportGoogleDocAsText(accessToken, c.id)).trim();
        } else {
          const buf = await downloadDriveFile(accessToken, c.id);
          const res = await extractAttachmentText({ name: c.name.split("/").pop() ?? c.name, base64: buf.toString("base64") });
          if (!res.ok) {
            failed.push(`${c.name} (${res.error})`);
            continue;
          }
          text = res.data.text;
        }
        if (!text) {
          failed.push(`${c.name} (no readable text)`);
          continue;
        }
        docs.push({ name: c.name, text, fullChars: text.length });
      } catch (e) {
        failed.push(`${c.name} (${e instanceof Error ? e.message.slice(0, 120) : String(e)})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, worker));

  docs.sort((a, b) => a.name.localeCompare(b.name));
  // Short files in full; what they leave unused goes to the long ones (see allocateBudget).
  const budget = allocateBudget(docs.map((d) => d.fullChars), TOTAL_CHARS);
  docs.forEach((d, i) => {
    d.text = d.text.slice(0, budget[i]);
  });
  if (docs.length) {
    const fmt = (n: number) => n.toLocaleString("en-US");
    notes.push(
      `Read ${docs.length} file(s). Shown in the prompt (characters shown of total): ` +
        docs.map((d, i) => `${d.name} ${fmt(budget[i])}/${fmt(d.fullChars)}`).join("; ") +
        ". A file shown partially is cut off at that point — say so if the missing part matters.",
    );
  }
  if (failed.length) notes.push(`Could not read: ${failed.join("; ")}.`);
  return { docs, notes };
}
