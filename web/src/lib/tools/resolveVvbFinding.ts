import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface ResolveVvbFindingInput {
  findingId: string;
  response: string;
  conclusion: string;
}

export interface ResolvedVvbFinding {
  findingId: string;
  status: "resolved";
}

/**
 * Resolve one open VVB finding — the proponent's real response and the
 * final conclusion, both required, per the same template that requires
 * a VVB to record both for every finding it closes out. Refuses on a
 * finding that does not exist or is already resolved, rather than
 * silently overwriting a real resolution.
 */
export async function resolveVvbFinding(
  ctx: ToolContext,
  input: ResolveVvbFindingInput,
): Promise<ToolResult<ResolvedVvbFinding>> {
  const guard = requireDbMode("resolveVvbFinding");
  if (guard) return guard;

  const policy = await checkPolicy("resolve_vvb_finding", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.response?.trim()) return fail("resolveVvbFinding: response is required.");
  if (!input.conclusion?.trim()) return fail("resolveVvbFinding: conclusion is required.");

  const { query } = await import("../db");

  const existing = await query<{ status: string; project_id: string; finding_type: string; issue_raised: string; stage: string; raised_by: string | null }>(
    `SELECT status::text, project_id, finding_type::text, issue_raised, stage::text, raised_by FROM mrv.vvb_findings WHERE finding_id = $1`,
    [input.findingId],
  );
  if (!existing.length) return fail("resolveVvbFinding: no such finding.");
  if (existing[0].status === "resolved") {
    return fail("resolveVvbFinding: this finding is already resolved.");
  }
  const finding = existing[0];

  await query(
    `UPDATE mrv.vvb_findings
        SET response = $2, conclusion = $3, status = 'resolved', resolved_at = now()
      WHERE finding_id = $1`,
    [input.findingId, input.response.trim(), input.conclusion.trim()],
  );

  await audit(ctx, "resolve_vvb_finding", { type: "vvb_finding", id: input.findingId }, {});

  // Stage 4 (finding -> lesson, generalized beyond just this tool): a
  // resolved VVB finding is exactly the "real professional finding" the
  // plan calls for — grounded in the actual issue and how it was really
  // resolved, not a generic summary. CAR (Corrective Action Request) is
  // the serious tier — always worth a lesson; CR/FAR/other still get one,
  // recordLesson's own "NOTHING" escape hatch handles the routine ones.
  const { recordLesson } = await import("../agent/lessonMemory");
  await recordLesson(ctx, {
    agentId: "dave",
    actionName: "resolve_vvb_finding",
    projectId: finding.project_id,
    domain: "mrv",
    outcomeSummary:
      `A VVB ${finding.finding_type} finding at the ${finding.stage} stage was resolved.\n` +
      `Issue raised: ${finding.issue_raised}\n\n` +
      `Response: ${input.response.trim()}\n` +
      `Conclusion: ${input.conclusion.trim()}`,
  });

  // Stage 8: fold this resolved finding into that VVB's own running
  // profile — this is the concrete case the plan named directly (a VVB's
  // known strictness pattern, built up from real CAR/CR/FAR history), not
  // just another episodic note competing with the last ten about it.
  if (finding.raised_by?.trim()) {
    const { updateEntityProfile } = await import("./updateEntityProfile");
    await updateEntityProfile(ctx, {
      entityType: "vvb",
      entityId: finding.raised_by.trim(),
      newEvidence:
        `${finding.finding_type} at the ${finding.stage} stage: "${finding.issue_raised}" — ` +
        `resolved with: "${input.conclusion.trim()}".`,
    });
  }

  return ok({ findingId: input.findingId, status: "resolved" });
}
