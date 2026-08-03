import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export type EligibilityCriteriaType =
  | "uniquely_identifiable"
  | "baseline_scenario"
  | "additionality"
  | "technology_or_measure"
  | "methodology_applicability_conditions";

const CRITERIA_TYPES: EligibilityCriteriaType[] = [
  "uniquely_identifiable",
  "baseline_scenario",
  "additionality",
  "technology_or_measure",
  "methodology_applicability_conditions",
];

export interface EligibilityCriterion {
  type: EligibilityCriteriaType;
  text: string;
}

export interface GroupedProjectDesignInput {
  projectId: string;
  /** Template's own shape: '[Project ID]_EA[N]', e.g. '9001_EA1'. */
  areaId: string;
  summary: string;
  criteria: EligibilityCriterion[];
}

export interface RecordedGroupedProjectDesign {
  areaId: string;
  criteriaRecorded: number;
  criteriaMissing: EligibilityCriteriaType[];
}

/**
 * Record one eligibility area of a grouped project — VCS PDD Template
 * v5.0A's own "Grouped Project Design" section, not an invented
 * checklist. An eligibility area lists where instances may be added and
 * the criteria a new instance must meet on each of the template's own
 * five axes; this only applies to grouped projects, exactly as the
 * template says: "For non-grouped projects... this section is not
 * applicable."
 */
export async function recordGroupedProjectDesign(
  ctx: ToolContext,
  input: GroupedProjectDesignInput,
): Promise<ToolResult<RecordedGroupedProjectDesign>> {
  const guard = requireDbMode("recordGroupedProjectDesign");
  if (guard) return guard;

  const policy = await checkPolicy("record_grouped_project_design", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.areaId?.trim()) return fail("recordGroupedProjectDesign: areaId is required.");
  if (!input.summary?.trim()) {
    return fail("recordGroupedProjectDesign: summary is required — boundary, activities/methodology, initial instances.");
  }
  for (const [i, c] of input.criteria.entries()) {
    if (!CRITERIA_TYPES.includes(c.type)) {
      return fail(`recordGroupedProjectDesign: criteria ${i + 1} has an unknown type "${c.type}".`);
    }
    if (!c.text?.trim()) return fail(`recordGroupedProjectDesign: criteria ${i + 1} (${c.type}) has no text.`);
  }
  const seen = new Set(input.criteria.map((c) => c.type));
  if (seen.size !== input.criteria.length) {
    return fail("recordGroupedProjectDesign: each criteria type may only be given once per area.");
  }

  const { query, withTransaction } = await import("../db");

  const projects = await query<{ is_grouped: boolean }>(
    `SELECT is_grouped FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("recordGroupedProjectDesign: no such project.");
  if (!projects[0].is_grouped) {
    return fail(
      "recordGroupedProjectDesign: this project is not grouped (mrv.projects.is_grouped is false) — the template's own instruction is that this section does not apply.",
    );
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO mrv.grouped_project_eligibility_areas (area_id, project_id, summary, recorded_by)
       VALUES ($1, $2, $3, $4)`,
      [input.areaId, input.projectId, input.summary, ctx.actor],
    );
    for (const c of input.criteria) {
      await tx.query(
        `INSERT INTO mrv.grouped_project_eligibility_criteria (area_id, criteria_type, criteria_text, recorded_by)
         VALUES ($1, $2, $3, $4)`,
        [input.areaId, c.type, c.text, ctx.actor],
      );
    }
  });

  const criteriaMissing = CRITERIA_TYPES.filter((t) => !seen.has(t));

  await audit(ctx, "record_grouped_project_design", { type: "eligibility_area", id: input.areaId }, {
    projectId: input.projectId,
    criteriaRecorded: input.criteria.length,
    criteriaMissing,
  });

  return ok({ areaId: input.areaId, criteriaRecorded: input.criteria.length, criteriaMissing });
}
