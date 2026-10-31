import "server-only";
import type { ToolContext } from "../../tools/context";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import { domainForAgent, oneOffTaskKey } from "./jobInput";

export interface RecalledForJob {
  /** Appended to the agent's system prompt; empty string when nothing was recalled. */
  block: string;
  lessons: number;
  memories: number;
}

/**
 * Same recall-then-fold pattern runAgentTask uses for a chat turn (recallLessons + recallDomainLessons),
 * plus the vector memory itself: the findings, conclusions and sources earlier one-off tasks stored.
 * Never throws — a missing memory is not a reason to block real work.
 */
export async function recallForJob(ctx: ToolContext, agentId: string, prompt: string): Promise<RecalledForJob> {
  try {
    const situation = prompt.slice(0, 300);
    const { recallLessons, recallDomainLessons } = await import("../lessonMemory");
    const { recallAgentMemory } = await import("../../tools/recallAgentMemory");

    const [own, domain, mem] = await Promise.all([
      recallLessons(ctx, { actionName: oneOffTaskKey(agentId), projectId: TARGET_PROJECT_ID, situation, limit: 4 }),
      recallDomainLessons(ctx, { domain: domainForAgent(agentId), situation, projectId: TARGET_PROJECT_ID, limit: 3 }),
      recallAgentMemory(ctx, { query: prompt.slice(0, 500), projectId: TARGET_PROJECT_ID, limit: 6 }),
    ]);

    const lessons = [...own, ...domain].map((l) => `- ${l.content}`);
    const memories = mem.ok
      ? mem.data.memories
          .filter((m) => m.kind !== "lesson")
          .map((m) => `- [${m.kind}, ${m.createdAt.slice(0, 10)}] ${m.content.slice(0, 500)}`)
      : [];

    const block =
      (lessons.length
        ? "\n\nLessons from your past one-off tasks and related work (apply them — don't repeat a known mistake):\n" +
          lessons.join("\n")
        : "") +
      (memories.length
        ? "\n\nThings you stored earlier that may be relevant (verify against the sources before relying on them; say when you use one):\n" +
          memories.join("\n")
        : "");
    return { block, lessons: lessons.length, memories: memories.length };
  } catch {
    return { block: "", lessons: 0, memories: 0 };
  }
}
