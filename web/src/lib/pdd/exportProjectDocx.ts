import "server-only";
import path from "node:path";
import fs from "node:fs";
import type { ToolContext } from "../tools/context";
import {
  buildPddDocxFromTemplate,
  extractAnnexSection,
  REQUEST_TYPES,
  type CoverPageFacts,
  type OrgProfileFacts,
} from "./injectPddTemplate";
import { getGhgReductionRows } from "./ghgReductionEstimates";

const LOGO_SOURCE_PATH = "docs/source/CarboNature_Logo.png";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Same local-timezone-Date gotcha syncPddGoogleDoc.ts documents — repeated
// here rather than shared for the same reason its own copy gives: two
// separate builders reading the same column, not one shared dependency.
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

// mrv.projects.status is CarboNature's own internal workflow state, not
// Verra's — real bug, confirmed live: this used to key off status, so
// the Request Type box stayed unchecked even for round 1, which is
// always pipeline listing until a real verra_registry_id exists.
function requestTypeForStatus(verraRegistryId: string | null): number | null {
  return verraRegistryId === null ? REQUEST_TYPES.indexOf("Pipeline listing (under development)") : null;
}

function readTemplateFileGuarded(sourcePath: string): Buffer {
  const repoRoot = path.resolve(process.cwd(), "..");
  const allowedDir = path.resolve(repoRoot, "docs", "source");
  const resolved = path.resolve(repoRoot, sourcePath);
  if (!resolved.startsWith(allowedDir + path.sep)) {
    throw new Error("template sourcePath is outside docs/source/.");
  }
  return fs.readFileSync(resolved);
}

export interface ExportedProjectDocx {
  buffer: Buffer;
  fileName: string;
}

/**
 * The same .docx syncPddGoogleDoc.ts builds for the live Google Doc, but
 * handed straight back as bytes instead of pushed to Drive — for the
 * "Download Drafted PDD" control, which needs a real file in the user's
 * own Downloads folder, not another cloud copy. Deliberately duplicates
 * syncPddGoogleDoc's build steps rather than importing it, because that
 * function's job is inseparable from the Drive upload it ends with; this
 * one's job ends at the buffer.
 */
export async function buildProjectDraftDocx(ctx: ToolContext, projectId: string): Promise<ExportedProjectDocx> {
  const { query } = await import("../db");
  const { generatePddDraft } = await import("../tools/generatePddDraft");
  const { listPddSectionStatus } = await import("./sectionStatus");

  const drafted = await generatePddDraft(ctx, { projectId });
  if (!drafted.ok) throw new Error(drafted.error);

  const templates = await query<{ template_id: string; source_path: string; name: string; version: string }>(
    `SELECT template_id, source_path, name, version FROM mrv.pdd_templates ORDER BY registered_at DESC LIMIT 1`,
  );
  if (!templates.length) throw new Error("no PDD template is registered yet.");
  const template = templates[0];

  const templateBuffer = readTemplateFileGuarded(template.source_path);

  const questionnaire = await listPddSectionStatus(query, projectId);
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
    status: string;
    verra_registry_id: string | null;
    crediting_start: string | Date | null;
    crediting_end: string | Date | null;
    project_start_date: string | Date | null;
  }>(
    `SELECT name, status, verra_registry_id, crediting_start, crediting_end, project_start_date FROM mrv.projects WHERE project_id = $1`,
    [projectId],
  );
  if (!projects.length) throw new Error("no such project.");
  const project = projects[0];

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

  const logoBuffer = readTemplateFileGuarded(LOGO_SOURCE_PATH);

  const coverPage: CoverPageFacts = {
    projectName: project.name,
    projectIdDisplay: project.verra_registry_id ?? "Not yet assigned — pending Verra pipeline listing",
    // Real activity start (earliest kick-off meeting) when known; the
    // crediting period's own start is a genuinely different date and
    // only stands in here until research_project_kickoff_date has run.
    projectStartDisplay: formatDdMmmYyyy(project.project_start_date ?? project.crediting_start),
    creditingStartDisplay: formatDdMmmYyyy(project.crediting_start),
    creditingEndDisplay: formatDdMmmYyyy(project.crediting_end),
    documentCompletionDateDisplay: formatDdMmmYyyy(new Date()),
    documentVersion: "v1.0",
    requestTypeChecked: requestTypeForStatus(project.verra_registry_id),
    logoPngBuffer: logoBuffer,
  };

  const ghgReductions = project.crediting_start && project.crediting_end
    ? await getGhgReductionRows(query, projectId, toUtcDateOnly(project.crediting_start), toUtcDateOnly(project.crediting_end))
    : null;

  const annex = extractAnnexSection(drafted.data.content);
  const buffer = await buildPddDocxFromTemplate(
    templateBuffer,
    sectionFills,
    annex.title,
    annex.body,
    coverPage,
    orgProfile,
    ghgReductions,
  );

  const safeName = project.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  // Content-Disposition's filename param is Latin-1 only (no em dash) —
  // an ASCII hyphen, not a hyphen-adjacent codepoint that looks the same.
  const fileName = `${safeName || projectId} - ${template.name} ${template.version}.docx`;

  return { buffer, fileName };
}
