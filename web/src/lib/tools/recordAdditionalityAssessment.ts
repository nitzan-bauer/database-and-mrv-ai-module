import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface Barrier {
  name: string;
  description: string;
}

export interface AdditionalityInput {
  projectId: string;
  regulatorySurplusMet: boolean;
  regulatorySurplusNote: string;
  barriers: Barrier[];
  commonPracticeRegion: string;
  /** Adoption rate 0-100 in the project region, or null if not determined. */
  commonPracticeAdoptionPct: number | null;
  step4cDemonstrated?: boolean;
  step4cNote?: string;
}

export interface RecordedAdditionality {
  assessmentId: string;
  regulatorySurplusMet: boolean;
  barrierCount: number;
  commonPracticeMet: boolean;
  overallMet: boolean;
}

/**
 * Record one VM0042 v2.2 §7 additionality assessment for a project — the
 * methodology's own three steps, not an invented checklist:
 *
 *   1. regulatory surplus (VCS Standard rules — recorded as met/not-met
 *      with the evidence note, since this repo has no source text for the
 *      VCS Standard's own surplus test to check automatically)
 *   2. barrier analysis (VT0008) — free-form, because VT0008's specific
 *      barrier categories are not a document this repo holds either; the
 *      same discipline as the baseline-site similarity criteria applies:
 *      record whichever barriers were actually identified.
 *   3. common practice — the one number VM0042's own text states plainly:
 *      adoption below 20% in the project region passes this step outright;
 *      at or above 20%, or unknown, Step 4c of VT0008 must be separately
 *      demonstrated. A null adoption percentage is treated the same as
 *      >=20% here, not as a pass by omission.
 *
 * overallMet is all three steps together — additionality is not
 * demonstrated by any one of them alone.
 */
export async function recordAdditionalityAssessment(
  ctx: ToolContext,
  input: AdditionalityInput,
): Promise<ToolResult<RecordedAdditionality>> {
  const guard = requireDbMode("recordAdditionalityAssessment");
  if (guard) return guard;

  const policy = await checkPolicy("record_additionality_assessment", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.regulatorySurplusNote?.trim()) {
    return fail("recordAdditionalityAssessment: regulatorySurplusNote is required — state the evidence, not just the verdict.");
  }
  if (!input.commonPracticeRegion?.trim()) {
    return fail("recordAdditionalityAssessment: commonPracticeRegion is required — VM0042 defines common practice per region.");
  }
  if (
    input.commonPracticeAdoptionPct != null &&
    (input.commonPracticeAdoptionPct < 0 || input.commonPracticeAdoptionPct > 100)
  ) {
    return fail("recordAdditionalityAssessment: commonPracticeAdoptionPct must be between 0 and 100.");
  }
  for (const [i, b] of input.barriers.entries()) {
    if (!b.name?.trim()) return fail(`recordAdditionalityAssessment: barrier ${i + 1} has no name.`);
  }

  const commonPracticeMet =
    input.commonPracticeAdoptionPct != null && input.commonPracticeAdoptionPct < 20
      ? true
      : Boolean(input.step4cDemonstrated);

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("recordAdditionalityAssessment: no such project.");

  const inserted = await query<{ assessment_id: string }>(
    `INSERT INTO mrv.additionality_assessments
       (project_id, regulatory_surplus_met, regulatory_surplus_note, barriers,
        common_practice_region, common_practice_adoption_pct, step4c_demonstrated, step4c_note, assessed_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
     RETURNING assessment_id`,
    [
      input.projectId,
      input.regulatorySurplusMet,
      input.regulatorySurplusNote,
      JSON.stringify(input.barriers),
      input.commonPracticeRegion,
      input.commonPracticeAdoptionPct,
      input.step4cDemonstrated ?? false,
      input.step4cNote ?? null,
      ctx.actor,
    ],
  );
  const assessmentId = inserted[0].assessment_id;

  const overallMet = input.regulatorySurplusMet && input.barriers.length > 0 && commonPracticeMet;

  await audit(ctx, "record_additionality_assessment", { type: "additionality_assessment", id: assessmentId }, {
    projectId: input.projectId,
    regulatorySurplusMet: input.regulatorySurplusMet,
    barrierCount: input.barriers.length,
    commonPracticeAdoptionPct: input.commonPracticeAdoptionPct,
    commonPracticeMet,
    overallMet,
  });

  return ok({
    assessmentId,
    regulatorySurplusMet: input.regulatorySurplusMet,
    barrierCount: input.barriers.length,
    commonPracticeMet,
    overallMet,
  });
}
