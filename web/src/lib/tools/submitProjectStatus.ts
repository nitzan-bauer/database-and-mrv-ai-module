import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

/**
 * The VM0042 pipeline's own forward order. Not a Verra API — Verra has no
 * public endpoint a proponent submits to; a real submission still happens
 * by hand, outside this repo. What this tool gives is the one thing that
 * was missing: an honest, audited record of which stage the project's
 * owner has actually declared it at, instead of the status column sitting
 * frozen at its insert-time default forever.
 */
const ORDER = ["under_development", "registered", "validated", "verified"] as const;
export type ProjectStatus = (typeof ORDER)[number];

export interface SubmitProjectStatusInput {
  projectId: string;
  status: ProjectStatus;
  note?: string;
}

export interface SubmittedProjectStatus {
  projectId: string;
  previousStatus: string;
  status: ProjectStatus;
}

export async function submitProjectStatus(
  ctx: ToolContext,
  input: SubmitProjectStatusInput,
): Promise<ToolResult<SubmittedProjectStatus>> {
  const guard = requireDbMode("submitProjectStatus");
  if (guard) return guard;

  const policy = await checkPolicy("submit_project_status", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ORDER.includes(input.status)) {
    return fail(`submitProjectStatus: status must be one of ${ORDER.join(", ")}.`);
  }

  const { query } = await import("../db");

  const projects = await query<{ status: string }>(
    `SELECT status FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("submitProjectStatus: no such project.");
  const previousStatus = projects[0].status;

  const fromIdx = ORDER.indexOf(previousStatus as ProjectStatus);
  const toIdx = ORDER.indexOf(input.status);
  if (fromIdx !== -1 && toIdx < fromIdx) {
    return fail(
      `submitProjectStatus: project is already "${previousStatus}" — this would move it backward to ` +
        `"${input.status}". If that is genuinely intended (e.g. correcting a mistaken submission), ` +
        "change it directly in Admin rather than through this tool.",
    );
  }

  await query(`UPDATE mrv.projects SET status = $2, updated_at = clock_timestamp() WHERE project_id = $1`, [
    input.projectId,
    input.status,
  ]);

  await audit(ctx, "submit_project_status", { type: "project", id: input.projectId }, {
    previousStatus,
    status: input.status,
    note: input.note ?? null,
  });

  return ok({ projectId: input.projectId, previousStatus, status: input.status });
}
