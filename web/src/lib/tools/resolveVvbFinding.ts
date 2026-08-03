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

  const existing = await query<{ status: string }>(`SELECT status::text FROM mrv.vvb_findings WHERE finding_id = $1`, [
    input.findingId,
  ]);
  if (!existing.length) return fail("resolveVvbFinding: no such finding.");
  if (existing[0].status === "resolved") {
    return fail("resolveVvbFinding: this finding is already resolved.");
  }

  await query(
    `UPDATE mrv.vvb_findings
        SET response = $2, conclusion = $3, status = 'resolved', resolved_at = now()
      WHERE finding_id = $1`,
    [input.findingId, input.response.trim(), input.conclusion.trim()],
  );

  await audit(ctx, "resolve_vvb_finding", { type: "vvb_finding", id: input.findingId }, {});

  return ok({ findingId: input.findingId, status: "resolved" });
}
