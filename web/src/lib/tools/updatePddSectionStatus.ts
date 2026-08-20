import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface UpdatedPddSectionStatus {
  statusId: string;
  sectionIndex: number;
  status: "pending" | "answered" | "skipped" | "drafted";
  reviewComment: string | null;
  devApproved: boolean;
}

/**
 * One row of the structured PDD questionnaire (0053) — answer, skip, or
 * reset a section. input_text is the human's own word standing behind a
 * claim; a model call is not that, no matter what status is requested —
 * confirmed live as a real incident: an earlier agent run wrote a
 * fabricated multi-year tonnage table into input_text under status
 * 'pending', mislabeled inline as "as directed by the project proponent",
 * which draftPddChapterContent then legitimately (by its own rules) used
 * as grounding and turned into prose Nitzan never said. The 'auto' tool
 * policy only ever gated *whether* an agent could call this tool, not
 * *which field* it could touch — this closes that gap at the only place
 * it can be closed for certain, not by trusting every future caller's
 * policy row.
 */
export async function updatePddSectionStatus(
  ctx: ToolContext,
  input: {
    projectId: string;
    templateId: string;
    sectionIndex: number;
    status?: "pending" | "answered" | "skipped";
    inputText?: string;
    /** PDD Development interface (0067): Nitzan's comments/tasks to Rebeka on the drafted answer. Omit to leave unchanged. */
    reviewComment?: string;
    /** PDD Development interface (0067): approve this section's drafted answer. Omit to leave unchanged. */
    devApproved?: boolean;
  },
): Promise<ToolResult<UpdatedPddSectionStatus>> {
  const guard = requireDbMode("updatePddSectionStatus");
  if (guard) return guard;

  if (ctx.actorKind !== "human") {
    return fail(
      "updatePddSectionStatus: input_text/review_comment/dev_approved are a human's own confirmed word — an agent cannot " +
        "write them, under any status. Use draft_pdd_chapter_content to propose drafted_text instead.",
    );
  }

  const policy = await checkPolicy("update_pdd_section_status", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (input.status !== undefined && !["pending", "answered", "skipped"].includes(input.status)) {
    return fail("updatePddSectionStatus: status must be pending, answered, or skipped.");
  }
  if (input.status === undefined && input.reviewComment === undefined && input.devApproved === undefined) {
    return fail("updatePddSectionStatus: nothing to update — pass status, reviewComment, or devApproved.");
  }

  // Only the fields actually passed get written — status/inputText (the SEED
  // questionnaire's own pair, always sent together by that UI) and
  // reviewComment/devApproved (the PDD Development interface's own fields,
  // sent independently) must not clobber each other when only one caller
  // is actually editing a section at a time.
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 3; // $1 projectId, $2 templateId, $3 sectionIndex are fixed below
  if (input.status !== undefined) {
    sets.push(`status = $${++i}`);
    values.push(input.status);
    sets.push(`input_text = $${++i}`);
    values.push(input.inputText ?? null);
  }
  if (input.reviewComment !== undefined) {
    sets.push(`review_comment = $${++i}`);
    values.push(input.reviewComment);
  }
  if (input.devApproved !== undefined) {
    sets.push(`dev_approved = $${++i}`);
    values.push(input.devApproved);
  }
  sets.push(`updated_by = $${++i}`);
  values.push(ctx.actor);

  const { query } = await import("../db");
  const rows = await query<{ status_id: string; status: "pending" | "answered" | "skipped" | "drafted"; review_comment: string | null; dev_approved: boolean }>(
    `UPDATE mrv.pdd_section_status
        SET ${sets.join(", ")}
      WHERE project_id = $1 AND template_id = $2 AND section_index = $3
      RETURNING status_id, status, review_comment, dev_approved`,
    [input.projectId, input.templateId, input.sectionIndex, ...values],
  );
  if (!rows.length) return fail("updatePddSectionStatus: no such section — it may need seeding first (open the questionnaire page once).");

  await audit(ctx, "update_pdd_section_status", { type: "pdd_section_status", id: rows[0].status_id }, {
    projectId: input.projectId,
    sectionIndex: input.sectionIndex,
    status: input.status,
    reviewCommentChanged: input.reviewComment !== undefined,
    devApprovedChanged: input.devApproved !== undefined,
  });

  // The generic learning-signal table (0078) alongside the existing
  // dev_approved flag — approving a drafted section is drafting's own
  // real approval signal, and this is what lets a future "is Rebeka's
  // drafting actually improving" query see it, not just this one flag.
  if (input.devApproved === true) {
    const { recordAgentFeedback } = await import("./recordAgentFeedback");
    await recordAgentFeedback(ctx, {
      agentId: "rebeka",
      actionName: "draft_pdd_chapter_content",
      targetType: "pdd_section_status",
      targetId: rows[0].status_id,
      verdict: "approved",
    });
  }

  return ok({
    statusId: rows[0].status_id,
    sectionIndex: input.sectionIndex,
    status: rows[0].status,
    reviewComment: rows[0].review_comment,
    devApproved: rows[0].dev_approved,
  });
}
