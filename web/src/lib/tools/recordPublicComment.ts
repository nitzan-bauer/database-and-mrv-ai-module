import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface PublicCommentInput {
  projectId: string;
  commentText: string;
  /** ISO date the comment was received. */
  receivedAt: string;
  isAfterCommentPeriod?: boolean;
  /** Required — the template asks for the justification, not just that a comment exists. */
  actionsTaken: string;
}

export interface RecordedPublicComment {
  commentId: string;
  projectId: string;
  isAfterCommentPeriod: boolean;
}

/**
 * Record one public comment — VCS PDD Template v5.0A's own "Public
 * Comments" table: list every comment submitted during the public
 * comment period (and any received after it), and justify how due
 * account was taken of each. actionsTaken is required for the same
 * reason additionality's regulatorySurplusNote is required: the
 * template asks explicitly to "justify why updates were not necessary
 * or appropriate", not merely to log that a comment arrived.
 */
export async function recordPublicComment(
  ctx: ToolContext,
  input: PublicCommentInput,
): Promise<ToolResult<RecordedPublicComment>> {
  const guard = requireDbMode("recordPublicComment");
  if (guard) return guard;

  const policy = await checkPolicy("record_public_comment", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.commentText?.trim()) return fail("recordPublicComment: commentText is required.");
  if (!input.receivedAt?.trim()) return fail("recordPublicComment: receivedAt is required.");
  if (Number.isNaN(Date.parse(input.receivedAt))) {
    return fail(`recordPublicComment: receivedAt "${input.receivedAt}" is not a valid date.`);
  }
  if (!input.actionsTaken?.trim()) {
    return fail(
      "recordPublicComment: actionsTaken is required — state what changed, or justify why nothing needed to.",
    );
  }

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("recordPublicComment: no such project.");

  const isAfterCommentPeriod = input.isAfterCommentPeriod ?? false;

  const inserted = await query<{ comment_id: string }>(
    `INSERT INTO mrv.public_comments
       (project_id, comment_text, received_at, is_after_comment_period, actions_taken, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING comment_id`,
    [input.projectId, input.commentText, input.receivedAt, isAfterCommentPeriod, input.actionsTaken, ctx.actor],
  );
  const commentId = inserted[0].comment_id;

  await audit(ctx, "record_public_comment", { type: "public_comment", id: commentId }, {
    projectId: input.projectId,
    receivedAt: input.receivedAt,
    isAfterCommentPeriod,
  });

  return ok({ commentId, projectId: input.projectId, isAfterCommentPeriod });
}
