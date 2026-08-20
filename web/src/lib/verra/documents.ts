import "server-only";

/**
 * Real Verra registry document download — found by live network
 * inspection (the same way searchVerraRegistry.ts's search endpoint was
 * found), not documented anywhere public. registry.verra.org is a
 * client-rendered SPA; fetch_public_url's plain GET cannot read it, but
 * the data underneath is a real, unauthenticated JSON/file API on
 * prod-us.api.platts.com — the same backend and headers
 * searchVerraRegistry.ts already uses (same `application: Markit`
 * header family).
 */

const HEADERS = {
  language: "en",
  standardId: "150000000000001",
  standardAcronym: "VCS",
  registry: "VERRA",
  appkey: "wOKHFGuxKApQaujPSKgF",
  application: "Markit",
};

export interface VerraProjectDocument {
  id: number;
  name: string;
}

/** The project's own document list — id + real filename, per Verra's public project-detail API. */
export async function fetchVerraProjectDocuments(verraProjectId: string): Promise<VerraProjectDocument[]> {
  const res = await fetch(
    `https://prod-us.api.platts.com/ci-raas-prod/br-reg/rest/public-report-manager/getProjectById/${encodeURIComponent(verraProjectId)}/Markit`,
    { headers: { ...HEADERS, accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Verra getProjectById(${verraProjectId}) returned ${res.status}`);
  const data = (await res.json()) as { projectDocumentList?: Array<{ project_document_id: number; project_document_name: string }> };
  return (data.projectDocumentList ?? [])
    .filter((d) => d.project_document_id && d.project_document_name)
    .map((d) => ({ id: d.project_document_id, name: d.project_document_name }));
}

/** One document's real bytes, by the id fetchVerraProjectDocuments returned. */
export async function downloadVerraDocument(documentId: number): Promise<Buffer> {
  const res = await fetch(
    "https://prod-us.api.platts.com/ci-raas-prod/br-reg/rest/document-manager/public/downloadDocumentById",
    {
      method: "POST",
      headers: { ...HEADERS, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ id: documentId }),
    },
  );
  if (!res.ok) throw new Error(`Verra downloadDocumentById(${documentId}) returned ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Best-effort mime type from the file's own extension — Verra's API doesn't reliably return content-type for every file. */
export function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}
