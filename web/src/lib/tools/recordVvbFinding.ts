import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export type VvbFindingType = "CAR" | "CR" | "FAR" | "other";
export type VvbFindingStage = "validation" | "verification";

const TYPES: VvbFindingType[] = ["CAR", "CR", "FAR", "other"];
const STAGES: VvbFindingStage[] = ["validation", "verification"];

export interface VvbFindingInput {
  projectId: string;
  stage: VvbFindingStage;
  findingType: VvbFindingType;
  issueRaised: string;
  raisedBy?: string | null;
  raisedAt?: string | null;
  /** Root-cause attribution (0101) — whichever of these the finding actually concerns, if known. All optional: most findings won't name one. */
  samplingCycleId?: string | null;
  modelRunId?: string | null;
  baselineSiteId?: string | null;
  workOrderId?: string | null;
}

export interface RecordedVvbFinding {
  findingId: string;
}

/**
 * Record one VVB finding — a Corrective Action Request, Clarification
 * Request, Forward Action Request, or another kind, per the VCS Joint
 * Validation & Verification Report Template's own categories. This logs
 * real correspondence a person already received; it does not simulate
 * the VVB or send anything, the same standing recordPublicComment has.
 */
export async function recordVvbFinding(
  ctx: ToolContext,
  input: VvbFindingInput,
): Promise<ToolResult<RecordedVvbFinding>> {
  const guard = requireDbMode("recordVvbFinding");
  if (guard) return guard;

  const policy = await checkPolicy("record_vvb_finding", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!STAGES.includes(input.stage)) return fail(`recordVvbFinding: unknown stage "${input.stage}".`);
  if (!TYPES.includes(input.findingType)) {
    return fail(`recordVvbFinding: unknown findingType "${input.findingType}" — must be CAR, CR, FAR, or other.`);
  }
  if (!input.issueRaised?.trim()) return fail("recordVvbFinding: issueRaised is required.");
  if (input.raisedAt != null && Number.isNaN(Date.parse(input.raisedAt))) {
    return fail(`recordVvbFinding: raisedAt "${input.raisedAt}" is not a valid date.`);
  }

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("recordVvbFinding: no such project.");

  const rows = await query<{ finding_id: string }>(
    `INSERT INTO mrv.vvb_findings
       (project_id, stage, finding_type, issue_raised, raised_by, raised_at, recorded_by,
        sampling_cycle_id, model_run_id, baseline_site_id, work_order_id)
     VALUES ($1, $2::mrv.vvb_finding_stage, $3::mrv.vvb_finding_type, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING finding_id`,
    [
      input.projectId,
      input.stage,
      input.findingType,
      input.issueRaised.trim(),
      input.raisedBy ?? null,
      input.raisedAt ?? null,
      ctx.actor,
      input.samplingCycleId ?? null,
      input.modelRunId ?? null,
      input.baselineSiteId ?? null,
      input.workOrderId ?? null,
    ],
  );
  const findingId = rows[0].finding_id;

  await audit(ctx, "record_vvb_finding", { type: "vvb_finding", id: findingId }, {
    projectId: input.projectId,
    stage: input.stage,
    findingType: input.findingType,
  });

  return ok({ findingId });
}
