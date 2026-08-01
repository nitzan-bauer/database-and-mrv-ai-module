import "server-only";
import { createHash } from "node:crypto";
import { extractOutline } from "../ingest/docx";
import {
  audit,
  checkPolicy,
  fail,
  ok,
  requireDbMode,
  type ToolContext,
  type ToolResult,
} from "./context";

export interface RegisteredTemplate {
  templateId: string;
  name: string;
  version: string;
  sectionCount: number;
  sha256: string;
}

/**
 * Register a Verra project-description template as data.
 *
 * The template is not this project's to fix in code: it differs by
 * methodology and Verra revises it over time, so what a PDD-writing skill
 * needs is whichever version is current, not a set of section names typed
 * into an agent's prompt. This parses the source .docx into an ordered
 * outline — headings, nesting, and the instructional text under each — and
 * stores that alongside the file's own hash, so a later PDD can point back
 * at exactly the template it was written against.
 *
 * mrv.pdd_templates is append-only: once a project starts drafting against
 * a version, that version cannot change under it. Registering a newer
 * version does not touch the old one; both remain, and whichever a given
 * project started on is what it keeps.
 */
export async function registerPddTemplate(
  ctx: ToolContext,
  input: {
    name: string;
    version: string;
    sourcePath: string;
    fileBytes: Buffer;
  },
): Promise<ToolResult<RegisteredTemplate>> {
  const guard = requireDbMode("registerPddTemplate");
  if (guard) return guard;

  const policy = await checkPolicy("register_pdd_template", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.name?.trim()) return fail("registerPddTemplate: a template name is required.");
  if (!input.version?.trim()) return fail("registerPddTemplate: a version is required.");

  let sections;
  try {
    sections = extractOutline(input.fileBytes);
  } catch (e) {
    return fail(
      `registerPddTemplate: could not read the document — ${e instanceof Error ? e.message : e}`,
    );
  }
  if (!sections.length) {
    return fail(
      "registerPddTemplate: no headings were found, so there is no section structure to store. " +
        "Check the document actually uses Word heading styles, not bold text made to look like one.",
    );
  }

  const sha256 = createHash("sha256").update(input.fileBytes).digest("hex");
  const { query } = await import("../db");

  const existing = await query<{ template_id: string }>(
    `SELECT template_id FROM mrv.pdd_templates WHERE name = $1 AND version = $2`,
    [input.name.trim(), input.version.trim()],
  );
  if (existing.length) {
    return fail(
      `registerPddTemplate: "${input.name}" ${input.version} is already registered. ` +
        "Templates are append-only — register a new version instead of trying to replace this one.",
    );
  }

  const inserted = await query<{ template_id: string }>(
    `INSERT INTO mrv.pdd_templates
       (name, version, source_path, source_sha256, section_count, structure, registered_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING template_id`,
    [
      input.name.trim(),
      input.version.trim(),
      input.sourcePath,
      sha256,
      sections.length,
      JSON.stringify(sections),
      ctx.actor,
    ],
  );
  const templateId = inserted[0].template_id;

  await audit(ctx, "register_pdd_template", { type: "pdd_template", id: templateId }, {
    name: input.name.trim(),
    version: input.version.trim(),
    sourcePath: input.sourcePath,
    sha256,
    sectionCount: sections.length,
  });

  return ok({
    templateId,
    name: input.name.trim(),
    version: input.version.trim(),
    sectionCount: sections.length,
    sha256,
  });
}
