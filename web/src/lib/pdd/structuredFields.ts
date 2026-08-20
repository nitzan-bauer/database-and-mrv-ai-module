import "server-only";

export type StructuredFieldType = "date_text" | "yes_no";

export interface StructuredFieldDef {
  key: string;
  label: string;
  type: StructuredFieldType;
  /** date_text only — must match the real template row's own label text exactly (fillTableRowsByLabel matches case-insensitively). */
  tableRowLabel?: string;
  /** yes_no only — the real template's own stable `<w:id>` values for the Yes and No content controls. */
  checkboxIds?: { yes: string; no: string };
}

/**
 * Per-section field definitions for PDD sections whose real content is a
 * Word table + Yes/No content controls, not prose (Nitzan's own request,
 * live this session, concrete example: section 1.4.3). Every value here
 * — row labels, checkbox ids — was read directly out of the real
 * registered template's own OOXML (docs/source/VCS_Project_Description_
 * Template_v5.0A.docx, word/document.xml), not guessed: the checkbox ids
 * in particular are the template's own stable identifiers, confirmed
 * unique per checkbox, which is what makes targeting one exactly by id
 * safe — no ordinal/positional guessing the way flipSecondCheckboxAfter
 * Anchor still has to for sections without a config entry here.
 *
 * Adding a new section is a matter of adding another entry here (find
 * its section_index via mrv.pdd_templates.structure, its table row
 * labels and checkbox ids via the template's own OOXML) — the storage,
 * UI, and injection mechanism below are all already generic.
 */
export const SECTION_STRUCTURED_FIELDS: Record<number, StructuredFieldDef[]> = {
  // 7 — "Eligibility of Projects Registered with Other GHG Programs" (VCS PDD template §1.4.3)
  7: [
    {
      key: "initial_crediting_start",
      label: "Initial crediting period start date",
      type: "date_text",
      tableRowLabel: "Initial crediting period start date",
    },
    {
      key: "other_ghg_registration_request_date",
      label: "Date of registration request in the other GHG program",
      type: "date_text",
      tableRowLabel: "Date of registration request in the other GHG program",
    },
    {
      key: "other_ghg_inactivity_date",
      label: "Date of project inactivity in the other GHG program",
      type: "date_text",
      tableRowLabel: "Date of project inactivity in the other GHG program",
    },
    {
      key: "registered_within_required_years",
      label:
        "Was registration requested with the other GHG program within the required number of years from the initial crediting period start date?",
      type: "yes_no",
      checkboxIds: { yes: "-47687280", no: "940493213" },
    },
    {
      key: "within_10_years",
      label: "Is VCS Program registration being requested within 10 years of the initial crediting period start date?",
      type: "yes_no",
      checkboxIds: { yes: "-211965437", no: "-2045819438" },
    },
    {
      key: "within_2_years_inactivity",
      label:
        "Is VCS Program registration being requested within two years of the date of project inactivity in the other GHG program?",
      type: "yes_no",
      checkboxIds: { yes: "41180810", no: "682160588" },
    },
    {
      key: "other_program_notified",
      label: "Was the other GHG program notified of the intent to register the project with the VCS Program?",
      type: "yes_no",
      checkboxIds: { yes: "-975839879", no: "-395519726" },
    },
  ],
};

export function structuredFieldsForSection(sectionIndex: number): StructuredFieldDef[] {
  return SECTION_STRUCTURED_FIELDS[sectionIndex] ?? [];
}

/** Every section_index that has a structured-field config — used to fetch all their saved values in one query. */
export function structuredSectionIndexes(): number[] {
  return Object.keys(SECTION_STRUCTURED_FIELDS).map(Number);
}

export type QueryFn = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

/** Every saved structured-field value for one project, keyed by section_index then field_key. */
export async function listStructuredFieldValues(
  query: QueryFn,
  projectId: string,
): Promise<Record<number, Record<string, string | null>>> {
  const indexes = structuredSectionIndexes();
  if (!indexes.length) return {};
  const rows = await query<{ section_index: number; field_key: string; field_value: string | null }>(
    `SELECT s.section_index, f.field_key, f.field_value
       FROM mrv.pdd_section_structured_fields f
       JOIN mrv.pdd_section_status s ON s.status_id = f.status_id
      WHERE s.project_id = $1 AND s.section_index = ANY($2::int[])`,
    [projectId, indexes],
  );
  const bySection: Record<number, Record<string, string | null>> = {};
  for (const r of rows) {
    (bySection[r.section_index] ??= {})[r.field_key] = r.field_value;
  }
  return bySection;
}

/**
 * Rebeka's own proposal for one structured field — only ever a value
 * she can ground in real, already-known data (e.g. the project's own
 * crediting_start date), and only ever inserted when nothing is there
 * yet. Unlike saveStructuredFieldValue (a human's own confirmed word,
 * always overwrites), this never clobbers a value a person already
 * saved — an agent proposing a field is a draft to review, not a
 * correction to someone's own confirmed answer.
 */
export async function proposeStructuredFieldValue(
  query: QueryFn,
  input: { statusId: string; fieldKey: string; fieldValue: string; proposedBy: string },
): Promise<void> {
  await query(
    `INSERT INTO mrv.pdd_section_structured_fields (status_id, field_key, field_value, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (status_id, field_key) DO NOTHING`,
    [input.statusId, input.fieldKey, input.fieldValue, input.proposedBy],
  );
}

/** Saves one structured field's value, upserting on (status_id, field_key). */
export async function saveStructuredFieldValue(
  query: QueryFn,
  input: { statusId: string; fieldKey: string; fieldValue: string | null; updatedBy: string },
): Promise<void> {
  await query(
    `INSERT INTO mrv.pdd_section_structured_fields (status_id, field_key, field_value, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (status_id, field_key) DO UPDATE SET
       field_value = excluded.field_value,
       updated_by = excluded.updated_by,
       updated_at = clock_timestamp()`,
    [input.statusId, input.fieldKey, input.fieldValue, input.updatedBy],
  );
}
