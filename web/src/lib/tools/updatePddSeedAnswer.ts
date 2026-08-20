import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { SEED_QUESTIONS } from "../pdd/seedQuestions";

export interface UpdatedPddSeedAnswer {
  questionKey: string;
  status: "pending" | "answered";
}

/**
 * One answer in the SEED questionnaire (0069) — human-only, same
 * standing and same reason as updatePddSectionStatus: this is the
 * founder's own confirmed word, not something an agent gets to write
 * under any status.
 */
export async function updatePddSeedAnswer(
  ctx: ToolContext,
  input: { projectId: string; questionKey: string; answerText: string },
): Promise<ToolResult<UpdatedPddSeedAnswer>> {
  const guard = requireDbMode("updatePddSeedAnswer");
  if (guard) return guard;

  if (ctx.actorKind !== "human") {
    return fail("updatePddSeedAnswer: this is the founder's own confirmed word — an agent cannot write it.");
  }

  const policy = await checkPolicy("update_pdd_seed_answer", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!SEED_QUESTIONS.some((q) => q.key === input.questionKey)) {
    return fail(`updatePddSeedAnswer: "${input.questionKey}" is not a known SEED question.`);
  }

  const status = input.answerText.trim() ? "answered" : "pending";
  const { query } = await import("../db");
  await query(
    `INSERT INTO mrv.pdd_seed_answers (project_id, question_key, answer_text, status, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, question_key) DO UPDATE SET
       answer_text = excluded.answer_text, status = excluded.status, updated_by = excluded.updated_by, updated_at = clock_timestamp()`,
    [input.projectId, input.questionKey, input.answerText.trim() || null, status, ctx.actor],
  );

  await audit(ctx, "update_pdd_seed_answer", { type: "project", id: input.projectId }, {
    questionKey: input.questionKey,
    status,
  });

  return ok({ questionKey: input.questionKey, status });
}
