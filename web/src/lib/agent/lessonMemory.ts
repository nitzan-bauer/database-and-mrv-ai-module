import "server-only";
import type { ToolContext } from "../tools/context";

/**
 * The mechanism half of the agent-learning plan (0078's own comment has
 * the full context: no Claude fine-tuning exists, so real "learning"
 * here is continual in-context learning — an accumulated 'lesson'
 * memory kind, synthesized after real outcomes, that future prompts
 * actually get built with. recordLesson is the write side; recallLessons
 * (below) is the read side draftPddChapterContent.ts calls before
 * building its own prompt.
 */

const LESSON_SYSTEM_PROMPT =
  "You extract one durable lesson from a completed task's outcome, for a future attempt at a similar task to " +
  "read before it acts. Write 1-2 short, concrete sentences — a specific thing that worked, failed, or should " +
  "be done differently, not a restatement of what happened. If there is genuinely nothing worth remembering " +
  "(a routine, unremarkable run), respond with exactly: NOTHING. Never pad a routine result into a fake lesson.";

/**
 * One model call to distill a lesson from a real outcome, recorded via
 * the existing recordAgentMemory (kind='lesson', metadata carries
 * actionName/agentId so recallLessons can filter by them). Silently
 * skips recording when the model finds nothing worth keeping — the
 * point is a memory worth reading later, not a lesson entry for every
 * routine run.
 */
export async function recordLesson(
  ctx: ToolContext,
  input: { agentId: string; actionName: string; projectId: string; outcomeSummary: string; domain?: string | null },
): Promise<void> {
  try {
    const { getConfiguredProvider } = await import("./provider");
    const provider = await getConfiguredProvider();
    const resp = await provider.complete({
      system: LESSON_SYSTEM_PROMPT,
      userMessage: `Action: ${input.actionName}\n\nOutcome:\n${input.outcomeSummary}`,
      tools: [],
    });
    const lesson = resp.kind === "text" ? resp.text.trim() : "";
    if (!lesson || lesson.toUpperCase() === "NOTHING") return;

    const { recordAgentMemory } = await import("../tools/recordAgentMemory");
    await recordAgentMemory(ctx, {
      projectId: input.projectId,
      kind: "lesson",
      content: lesson,
      domain: input.domain ?? null,
      metadata: { actionName: input.actionName, agentId: input.agentId },
    });
  } catch {
    // A lesson is a quality improvement, not a dependency — a synthesis
    // failure must never fail the task it's summarizing.
  }
}

export interface RecalledLesson {
  content: string;
  createdAt: string;
}

/**
 * Past lessons for this action, semantically ranked against the
 * current situation — a thin filter over the existing recallAgentMemory
 * (kind='lesson'), UNIONED with real human verdicts from mrv.agent_feedback
 * (corrected/rejected, with the actual correction text) for the same
 * action. Until this, the two mechanisms never spoke to each other —
 * recallLessons only ever saw its own synthesized 'lesson' memories, never
 * the much stronger signal of an actual human correction. Returns an
 * empty array on any failure; a missing lesson is not a reason to block
 * real work.
 */
export async function recallLessons(
  ctx: ToolContext,
  input: { actionName: string; projectId: string; situation?: string; limit?: number },
): Promise<RecalledLesson[]> {
  const limit = input.limit ?? 3;
  let synthesized: RecalledLesson[] = [];
  try {
    const { recallAgentMemory } = await import("../tools/recallAgentMemory");
    const result = await recallAgentMemory(ctx, {
      query: `${input.actionName}: ${input.situation ?? "general guidance"}`,
      projectId: input.projectId,
      kind: "lesson",
      limit,
    });
    if (result.ok) {
      synthesized = result.data.memories
        .filter((m) => m.metadata.actionName === input.actionName)
        .map((m) => ({ content: m.content, createdAt: m.createdAt }));
    }
  } catch {
    // fall through — a missing synthesized lesson is not fatal
  }

  let corrections: RecalledLesson[] = [];
  try {
    const { query } = await import("../db");
    const rows = await query<{ correction_text: string; verdict: string; created_at: string }>(
      `SELECT correction_text, verdict, created_at::text
         FROM mrv.agent_feedback
        WHERE action_name = $1 AND verdict IN ('corrected', 'rejected') AND correction_text IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $2`,
      [input.actionName, limit],
    );
    corrections = rows.map((r) => ({
      content: `A human ${r.verdict} a past result of this action: ${r.correction_text}`,
      createdAt: r.created_at,
    }));
  } catch {
    // fall through — same non-fatal stance as the synthesized side
  }

  return [...corrections, ...synthesized].slice(0, limit);
}

/**
 * Cross-agent lessons for a whole professional domain (e.g. 'mrv' —
 * spanning Rebeka's PDD drafting, Dave's monitoring/verification, and
 * John's credit/allocation work), not scoped to one exact actionName the
 * way recallLessons is. This is what lets a lesson Dave records from a
 * VVB finding actually reach Rebeka while she's drafting a methodology
 * section, and vice versa — recallLessons alone never crosses that
 * boundary, by design (it's the narrow, same-task mechanism). The two are
 * meant to run side by side, not replace one another.
 */
export async function recallDomainLessons(
  ctx: ToolContext,
  input: { domain: string; situation: string; projectId?: string | null; limit?: number },
): Promise<RecalledLesson[]> {
  try {
    const { recallAgentMemory } = await import("../tools/recallAgentMemory");
    const result = await recallAgentMemory(ctx, {
      query: input.situation,
      projectId: input.projectId ?? null,
      kind: "lesson",
      domain: input.domain,
      limit: input.limit ?? 3,
    });
    if (!result.ok) return [];
    return result.data.memories.map((m) => ({ content: m.content, createdAt: m.createdAt }));
  } catch {
    return [];
  }
}
