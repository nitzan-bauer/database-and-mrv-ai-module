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
  input: { agentId: string; actionName: string; projectId: string; outcomeSummary: string },
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
 * (kind='lesson'). Returns an empty array on any failure; a missing
 * lesson is not a reason to block real work.
 */
export async function recallLessons(
  ctx: ToolContext,
  input: { actionName: string; projectId: string; situation?: string; limit?: number },
): Promise<RecalledLesson[]> {
  try {
    const { recallAgentMemory } = await import("../tools/recallAgentMemory");
    const result = await recallAgentMemory(ctx, {
      query: `${input.actionName}: ${input.situation ?? "general guidance"}`,
      projectId: input.projectId,
      kind: "lesson",
      limit: input.limit ?? 3,
    });
    if (!result.ok) return [];
    return result.data.memories
      .filter((m) => m.metadata.actionName === input.actionName)
      .map((m) => ({ content: m.content, createdAt: m.createdAt }));
  } catch {
    return [];
  }
}
