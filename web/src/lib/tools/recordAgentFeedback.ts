import "server-only";
import { audit, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface AgentFeedbackInput {
  agentId: string;
  actionName: string;
  targetType?: string | null;
  targetId?: string | null;
  verdict: "approved" | "corrected" | "rejected";
  correctionText?: string | null;
}

export interface RecordedAgentFeedback {
  feedbackId: string;
}

/**
 * A human's own verdict on a specific agent action — approved,
 * corrected, or rejected (0078). Human-only, same reasoning as
 * updatePddSectionStatus.ts: a verdict on an agent's work is a
 * person's own confirmed judgement, not something an agent can record
 * about itself. This is the generic seam every future feedback surface
 * writes into; the PDD Development "Approve" button is the first real
 * caller (see updatePddSectionStatus.ts).
 */
export async function recordAgentFeedback(
  ctx: ToolContext,
  input: AgentFeedbackInput,
): Promise<ToolResult<RecordedAgentFeedback>> {
  const guard = requireDbMode("recordAgentFeedback");
  if (guard) return guard;

  if (ctx.actorKind !== "human") {
    return fail("recordAgentFeedback: a verdict on an agent's work is a person's own judgement — an agent cannot record it about itself.");
  }

  const { query } = await import("../db");
  const rows = await query<{ feedback_id: string }>(
    `INSERT INTO mrv.agent_feedback (agent_id, action_name, target_type, target_id, verdict, correction_text, given_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING feedback_id`,
    [
      input.agentId,
      input.actionName,
      input.targetType ?? null,
      input.targetId ?? null,
      input.verdict,
      input.correctionText ?? null,
      ctx.actor,
    ],
  );
  const feedbackId = rows[0].feedback_id;

  await audit(ctx, "record_agent_feedback", { type: "agent_feedback", id: feedbackId }, {
    agentId: input.agentId,
    actionName: input.actionName,
    verdict: input.verdict,
  });

  return ok({ feedbackId });
}
