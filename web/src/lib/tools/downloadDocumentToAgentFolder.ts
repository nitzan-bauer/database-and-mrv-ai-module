import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { validatePublicUrl } from "./fetchPublicUrl";

/**
 * John's own request-driven capability (Nitzan's own spec: "go into
 * websites and download documents, sort them into folders by criteria
 * we'll define later") — paired with browse_website (already built for
 * Rebeka/Dave) for the crawling half, this is the download-and-place
 * half. Deliberately leaves "which folder" as a plain parameter rather
 * than any hardcoded classification logic: the sorting criteria are
 * Nitzan's to define per use, in chat, at call time — John (or any
 * agent later granted this tool) decides the destination from whatever
 * instructions it's given that turn.
 *
 * Reuses fetchPublicUrl's own validatePublicUrl (https-only + the same
 * SSRF blocklist) rather than a second copy of it, but fetches the raw
 * bytes via arrayBuffer — fetchAndExtractPage always calls res.text(),
 * which would corrupt a binary PDF/docx.
 */

export interface DownloadDocumentInput {
  url: string;
  agentId: string;
  fileName?: string;
}

export interface DownloadedDocument {
  agentId: string;
  fileName: string;
  driveFileId: string;
  byteLength: number;
}

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024;

export async function downloadDocumentToAgentFolder(
  ctx: ToolContext,
  input: DownloadDocumentInput,
): Promise<ToolResult<DownloadedDocument>> {
  const guard = requireDbMode("downloadDocumentToAgentFolder");
  if (guard) return guard;

  const policy = await checkPolicy("download_document_to_agent_folder", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return fail("downloadDocumentToAgentFolder: not a valid URL.");
  }
  const invalid = validatePublicUrl(parsed);
  if (invalid) return fail(`downloadDocumentToAgentFolder: ${invalid}`);

  if (!ctx.googleAccessToken) return fail("downloadDocumentToAgentFolder: no Google access token this run.");

  const { query } = await import("../db");
  const agents = await query<{ drive_folder_id: string | null }>(`SELECT drive_folder_id FROM mrv.agents WHERE agent_id = $1`, [input.agentId]);
  if (!agents.length) return fail(`downloadDocumentToAgentFolder: no such agent "${input.agentId}".`);
  if (!agents[0].drive_folder_id) return fail(`downloadDocumentToAgentFolder: ${input.agentId} has no Drive folder linked yet.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "CarboNature-MRV/1.0 (+https://carbonature.io)" },
    });
  } catch (e) {
    return fail(`downloadDocumentToAgentFolder: fetch failed — ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) return fail(`downloadDocumentToAgentFolder: ${parsed.toString()} returned ${res.status}.`);

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return fail("downloadDocumentToAgentFolder: downloaded file was empty.");
  if (buf.byteLength > MAX_BYTES) {
    return fail(`downloadDocumentToAgentFolder: file is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${MAX_BYTES / 1024 / 1024}MB limit.`);
  }

  const fileName = input.fileName?.trim() || decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "document");

  const { uploadFileToDriveFolder } = await import("../google/driveClient");
  const uploaded = await uploadFileToDriveFolder(ctx.googleAccessToken, agents[0].drive_folder_id, fileName, contentType, buf);

  await audit(
    ctx,
    "download_document_to_agent_folder",
    { type: "drive_file", id: uploaded.id },
    { agentId: input.agentId, sourceUrl: parsed.toString(), fileName, byteLength: buf.byteLength },
  );

  return ok({ agentId: input.agentId, fileName, driveFileId: uploaded.id, byteLength: buf.byteLength });
}
