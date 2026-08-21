import "server-only";
import path from "node:path";
import fs from "node:fs";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { createGoogleDocFromDocx, updateGoogleDocFromDocx } from "../google/driveClient";
import { ensureProjectDriveFolder } from "../google/ensureProjectFolder";
import {
  buildPddDocxFromTemplate,
  extractAnnexSection,
  REQUEST_TYPES,
  type CoverPageFacts,
  type OrgProfileFacts,
} from "../pdd/injectPddTemplate";
import { getGhgReductionRows } from "../pdd/ghgReductionEstimates";

const LOGO_SOURCE_PATH = "docs/source/CarboNature_Logo.png";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * node-postgres parses a `date` column as a JS Date constructed in the
 * *server process's own local timezone* at midnight of that calendar
 * date — not UTC — despite what a hand-written query type might claim,
 * so this accepts both. For a Date, local getters recover the original
 * Y/M/D correctly for exactly that reason (confirmed live: UTC getters
 * rolled '2026-07-01' back to 30-Jun-2026 on this UTC-ahead server — the
 * same family of drift as rowToProject's crediting_end display, caused
 * by the opposite mistake there). For a string, slicing the ISO text
 * directly avoids `new Date(str)`'s own local-time reinterpretation.
 */
function formatDdMmmYyyy(value: string | Date | null): string {
  if (!value) return "[NEEDS: date not yet set]";
  if (value instanceof Date) {
    return `${String(value.getDate()).padStart(2, "0")}-${MONTHS[value.getMonth()]}-${value.getFullYear()}`;
  }
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}

/** Normalizes either shape node-postgres can hand back for a `date` column into a UTC-midnight Date, for period math. */
function toUtcDateOnly(value: string | Date): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * mrv.projects.status is CarboNature's own internal workflow state, not
 * Verra's — confirmed live as a real bug: status='registered' here means
 * "active in our own system", and was being read as if it meant
 * "registered with Verra", leaving every Request Type box unchecked even
 * though round 1 always is pipeline listing (Nitzan's own instruction).
 * The real Verra filing state is verraRegistryId: null until a project
 * has actually been submitted, so that's what this keys off now. Once a
 * project has a real verra_registry_id, this deliberately still returns
 * null rather than guessing which later category (renewal, revision,
 * reassessment) applies — that guess is exactly the kind of claim this
 * build refuses to invent, and a person must pick it themselves.
 */
function requestTypeForStatus(verraRegistryId: string | null): number | null {
  return verraRegistryId === null ? REQUEST_TYPES.indexOf("Pipeline listing (under development)") : null;
}

/**
 * Same docs/source/ boundary registerPddTemplateFromDisk enforces —
 * repeated here rather than shared, because the two callers read the
 * file for different reasons (one to register it, one to fill it in)
 * and a shared helper would need to serve both without either one
 * trusting the other's path handling implicitly.
 */
function readTemplateFileGuarded(sourcePath: string): Buffer {
  const repoRoot = path.resolve(process.cwd(), "..");
  const allowedDir = path.resolve(repoRoot, "docs", "source");
  const resolved = path.resolve(repoRoot, sourcePath);
  if (!resolved.startsWith(allowedDir + path.sep)) {
    throw new Error("template sourcePath is outside docs/source/.");
  }
  return fs.readFileSync(resolved);
}

export interface SyncedPddGoogleDoc {
  projectId: string;
  googleDocId: string;
  googleDocUrl: string;
  created: boolean;
  sectionsFilled: number;
  sectionsTotal: number;
}

/**
 * The live PDD document — Google Docs, not a read-only export. Stage 1 of
 * the real workflow (draft from scratch, partially complete, registered
 * as Under Development) needs a document Nitzan can actually open and
 * edit, and stages 2-4 (submission, VVB validation, the comment
 * ping-pong) need one an external VVB can eventually reach — neither is
 * true of a raw text export.
 *
 * Built on Verra's actual registered template file, not a document
 * reconstructed from its extracted outline — every part of the real
 * .docx (cover page, logos, headers/footers, styles) is carried
 * through unchanged; only new paragraphs are inserted under each
 * heading and in a verified-facts annex at the end (see
 * lib/pdd/injectPddTemplate.ts for why and how).
 *
 * The database stays the source of truth: this regenerates the .docx
 * on every call and overwrites the Doc's content (via Drive's own
 * .docx-to-Google-Doc conversion — see driveClient.ts). That means an
 * edit typed directly into the Doc does NOT flow back into mrv — a
 * one-directional sync, not real-time collaborative merge. Good enough
 * for "here is the current state of the facts, work from it"; reading
 * human edits back out is a separate, larger project.
 */
export async function syncPddGoogleDoc(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<SyncedPddGoogleDoc>> {
  const guard = requireDbMode("syncPddGoogleDoc");
  if (guard) return guard;

  const policy = await checkPolicy("sync_pdd_google_doc", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("syncPddGoogleDoc: no Google Drive access token for this session — sign in with Drive access.");
  }

  const { query } = await import("../db");
  const { generatePddDraft } = await import("./generatePddDraft");
  const { listPddSectionStatus } = await import("../pdd/sectionStatus");

  // generatePddDraft still does the real work of gathering verified
  // facts (farms, additionality, compliance) — reused here for its
  // Annex A text, not for the section-outline reconstruction it also
  // does, which the real template file itself now provides.
  const drafted = await generatePddDraft(ctx, { projectId: input.projectId });
  if (!drafted.ok) return fail(`syncPddGoogleDoc: ${drafted.error}`);

  const templates = await query<{ template_id: string; source_path: string; name: string; version: string }>(
    `SELECT template_id, source_path, name, version FROM mrv.pdd_templates ORDER BY registered_at DESC LIMIT 1`,
  );
  if (!templates.length) return fail("syncPddGoogleDoc: no PDD template is registered yet.");
  const template = templates[0];

  let templateBuffer: Buffer;
  try {
    templateBuffer = readTemplateFileGuarded(template.source_path);
  } catch (e) {
    return fail(`syncPddGoogleDoc: could not read the registered template file — ${e instanceof Error ? e.message : e}.`);
  }

  const questionnaire = await listPddSectionStatus(query, input.projectId);
  const sectionFills = new Map<number, { inputText: string | null; draftedText: string | null }>(
    (questionnaire?.rows ?? []).map((r) => [
      r.sectionIndex,
      {
        inputText: r.status === "answered" ? r.inputText : null,
        draftedText: r.status === "drafted" ? r.draftedText : null,
      },
    ]),
  );

  const projects = await query<{
    name: string;
    google_doc_id: string | null;
    status: string;
    verra_registry_id: string | null;
    crediting_start: string | Date | null;
    crediting_end: string | Date | null;
    project_start_date: string | Date | null;
  }>(
    `SELECT name, google_doc_id, status, verra_registry_id, crediting_start, crediting_end, project_start_date
       FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("syncPddGoogleDoc: no such project.");
  const project = projects[0];

  let logoBuffer: Buffer;
  try {
    logoBuffer = readTemplateFileGuarded(LOGO_SOURCE_PATH);
  } catch (e) {
    return fail(`syncPddGoogleDoc: could not read CarboNature's logo file — ${e instanceof Error ? e.message : e}.`);
  }

  const orgProfiles = await query<{
    legal_name: string;
    address: string;
    contact_name: string;
    contact_title: string;
    contact_email: string;
    contact_phone: string;
  }>(
    `SELECT legal_name, address, contact_name, contact_title, contact_email, contact_phone FROM mrv.org_profile LIMIT 1`,
  );
  const orgProfile: OrgProfileFacts | null = orgProfiles.length
    ? {
        legalName: orgProfiles[0].legal_name,
        address: orgProfiles[0].address,
        contactName: orgProfiles[0].contact_name,
        contactTitle: orgProfiles[0].contact_title,
        contactEmail: orgProfiles[0].contact_email,
        contactPhone: orgProfiles[0].contact_phone,
      }
    : null;

  const coverPage: CoverPageFacts = {
    projectName: project.name,
    projectIdDisplay: project.verra_registry_id ?? "Not yet assigned — pending Verra pipeline listing",
    projectStartDisplay: formatDdMmmYyyy(project.project_start_date ?? project.crediting_start),
    creditingStartDisplay: formatDdMmmYyyy(project.crediting_start),
    creditingEndDisplay: formatDdMmmYyyy(project.crediting_end),
    documentCompletionDateDisplay: formatDdMmmYyyy(new Date()),
    documentVersion: "v1.0",
    requestTypeChecked: requestTypeForStatus(project.verra_registry_id),
    logoPngBuffer: logoBuffer,
  };

  const ghgReductions = project.crediting_start && project.crediting_end
    ? await getGhgReductionRows(query, input.projectId, toUtcDateOnly(project.crediting_start), toUtcDateOnly(project.crediting_end))
    : null;

  const { listStructuredFieldValues } = await import("../pdd/structuredFields");
  const structuredValuesBySection = await listStructuredFieldValues(query, input.projectId);

  const annex = extractAnnexSection(drafted.data.content);
  let docxBuffer: Buffer;
  try {
    docxBuffer = await buildPddDocxFromTemplate(
      templateBuffer,
      sectionFills,
      annex.title,
      annex.body,
      coverPage,
      orgProfile,
      ghgReductions,
      structuredValuesBySection,
    );
  } catch (e) {
    return fail(`syncPddGoogleDoc: could not fill in the template — ${e instanceof Error ? e.message : e}.`);
  }
  const fileName = `${drafted.data.templateName} ${drafted.data.templateVersion} — ${project.name}`;

  let folderId: string;
  try {
    folderId = await ensureProjectDriveFolder(ctx.googleAccessToken, input.projectId, project.name);
  } catch (e) {
    return fail(`syncPddGoogleDoc: could not create the project's Drive folder — ${e instanceof Error ? e.message : e}.`);
  }

  let googleDocId: string;
  let googleDocUrl: string;
  let created: boolean;

  if (project.google_doc_id) {
    let file;
    try {
      file = await updateGoogleDocFromDocx(ctx.googleAccessToken, project.google_doc_id, docxBuffer);
    } catch (e) {
      return fail(`syncPddGoogleDoc: could not update the existing Google Doc — ${e instanceof Error ? e.message : e}.`);
    }
    googleDocId = file.id;
    googleDocUrl = file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;
    created = false;
  } else {
    let file;
    try {
      file = await createGoogleDocFromDocx(ctx.googleAccessToken, fileName, docxBuffer, folderId);
    } catch (e) {
      return fail(`syncPddGoogleDoc: could not create a Google Doc — ${e instanceof Error ? e.message : e}.`);
    }
    googleDocId = file.id;
    googleDocUrl = file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;
    created = true;
    await query(`UPDATE mrv.projects SET google_doc_id = $2, google_doc_url = $3 WHERE project_id = $1`, [
      input.projectId,
      googleDocId,
      googleDocUrl,
    ]);
  }

  await audit(ctx, "sync_pdd_google_doc", { type: "project", id: input.projectId }, {
    googleDocId,
    created,
    sectionsFilled: drafted.data.sectionsFilled,
    sectionsTotal: drafted.data.sectionsTotal,
  });

  return ok({
    projectId: input.projectId,
    googleDocId,
    googleDocUrl,
    created,
    sectionsFilled: drafted.data.sectionsFilled,
    sectionsTotal: drafted.data.sectionsTotal,
  });
}
