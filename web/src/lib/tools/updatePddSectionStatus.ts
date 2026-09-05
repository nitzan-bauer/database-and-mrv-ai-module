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
    /**
     * 0082 — one named table-cell/checkbox value for a section that has a
     * structured-field config (src/lib/pdd/structuredFields.ts), e.g.
     * {fieldKey: "initial_crediting_start", fieldValue: "15-Mar-2025"}.
     * Independent of status/inputText — a structured section's "answer"
     * is these named fields, not a prose blob.
     */
    structuredField?: { fieldKey: string; fieldValue: string | null };
  },
): Promise<ToolResult<UpdatedPddSectionStatus>> {
  const guard = requireDbMode("updatePddSectionStatus");
  if (guard) return guard;

  if (ctx.actorKind !== "human") {
    return fail(
      "updatePddSectionStatus: input_text/review_comment/dev_approved/structuredField are a human's own confirmed " +
        "word — an agent cannot write them, under any status. Use draft_pdd_chapter_content to propose drafted_text instead.",
    );
  }

  const policy = await checkPolicy("update_pdd_section_status", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (input.status !== undefined && !["pending", "answered", "skipped"].includes(input.status)) {
    return fail("updatePddSectionStatus: status must be pending, answered, or skipped.");
  }
  if (
    input.status === undefined &&
    input.reviewComment === undefined &&
    input.devApproved === undefined &&
    input.structuredField === undefined
  ) {
    return fail("updatePddSectionStatus: nothing to update — pass status, reviewComment, devApproved, or structuredField.");
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
  const rows = await query<{
    status_id: string;
    status: "pending" | "answered" | "skipped" | "drafted";
    review_comment: string | null;
    dev_approved: boolean;
    section_title: string;
    drafted_text: string | null;
  }>(
    `UPDATE mrv.pdd_section_status
        SET ${sets.join(", ")}
      WHERE project_id = $1 AND template_id = $2 AND section_index = $3
      RETURNING status_id, status, review_comment, dev_approved, section_title, drafted_text`,
    [input.projectId, input.templateId, input.sectionIndex, ...values],
  );
  if (!rows.length) return fail("updatePddSectionStatus: no such section — it may need seeding first (open the questionnaire page once).");

  if (input.structuredField) {
    const { saveStructuredFieldValue } = await import("../pdd/structuredFields");
    await saveStructuredFieldValue(query, {
      statusId: rows[0].status_id,
      fieldKey: input.structuredField.fieldKey,
      fieldValue: input.structuredField.fieldValue,
      updatedBy: ctx.actor,
    });
  }

  await audit(ctx, "update_pdd_section_status", { type: "pdd_section_status", id: rows[0].status_id }, {
    projectId: input.projectId,
    sectionIndex: input.sectionIndex,
    status: input.status,
    reviewCommentChanged: input.reviewComment !== undefined,
    devApprovedChanged: input.devApproved !== undefined,
    structuredFieldKey: input.structuredField?.fieldKey ?? null,
  });

  // The generic learning-signal table (0078) alongside the existing
  // dev_approved flag. Until now only 'approved' was ever recorded — the
  // much stronger 'corrected'/'rejected' signals were silently dropped,
  // even though recallLessons (lessonMemory.ts) now reads them. A real
  // reviewComment is a correction (it carries the actual substance of
  // what was wrong); an explicit devApproved:false with no comment this
  // same call is a bare rejection.
  if (input.reviewComment !== undefined && input.reviewComment.trim()) {
    const { recordAgentFeedback } = await import("./recordAgentFeedback");
    await recordAgentFeedback(ctx, {
      agentId: "rebeka",
      actionName: "draft_pdd_chapter_content",
      targetType: "pdd_section_status",
      targetId: rows[0].status_id,
      verdict: "corrected",
      correctionText: input.reviewComment.trim(),
    });

    // Stage 4 (generic finding -> lesson trigger): a lesson synthesized
    // right now, from the actual diff (what was drafted vs. what was
    // wrong with it) — not the generic per-run summary
    // draftPddChapterContent's own recordLesson call produces at the end
    // of a whole drafting pass. This is a stronger, more specific signal:
    // it fires the moment a human corrects something, grounded in the
    // real text, not "N sections drafted, no errors".
    if (rows[0].drafted_text?.trim()) {
      const { recordLesson } = await import("../agent/lessonMemory");
      await recordLesson(
        { actor: "rebeka", actorKind: "agent" },
        {
          agentId: "rebeka",
          actionName: "draft_pdd_chapter_content",
          projectId: input.projectId,
          domain: "mrv",
          outcomeSummary:
            `Section "${rows[0].section_title}" was corrected by a human reviewer.\n` +
            `What was drafted:\n${rows[0].drafted_text.trim().slice(0, 1500)}\n\n` +
            `The correction:\n${input.reviewComment.trim()}`,
        },
      );
    }
  } else if (input.devApproved === true) {
    const { recordAgentFeedback } = await import("./recordAgentFeedback");
    await recordAgentFeedback(ctx, {
      agentId: "rebeka",
      actionName: "draft_pdd_chapter_content",
      targetType: "pdd_section_status",
      targetId: rows[0].status_id,
      verdict: "approved",
    });
  } else if (input.devApproved === false) {
    const { recordAgentFeedback } = await import("./recordAgentFeedback");
    await recordAgentFeedback(ctx, {
      agentId: "rebeka",
      actionName: "draft_pdd_chapter_content",
      targetType: "pdd_section_status",
      targetId: rows[0].status_id,
      verdict: "rejected",
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
