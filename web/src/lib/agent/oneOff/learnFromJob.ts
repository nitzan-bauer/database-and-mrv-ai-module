import "server-only";
import type { ToolContext } from "../../tools/context";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import { domainForAgent, oneOffTaskKey, parseMemoryItems, type Routing } from "./jobInput";
import type { OneOffJob } from "./jobStore";

const EXTRACT_SYSTEM_PROMPT =
  "You are an agent's memory clerk. From the finished one-off task below, extract the durable knowledge worth " +
  "remembering months from now. Return ONLY a JSON array (at most 8 items) of " +
  '{"kind":"finding"|"conclusion"|"source"|"open_question","text":"..."}. ' +
  "Each text is one or two self-contained sentences in the language of the request, with the source URL or file " +
  "name inside the text when there is one. Skip anything that would not help a future task. " +
  "If nothing durable, return [].";

/**
 * After a finished task: atomic findings/conclusions/sources into long-term memory (one row each, with the job id,
 * topic, farm and links in metadata — far easier to retrieve than one blob), plus a lesson about HOW the task went.
 * finishScheduledTask already stores the whole report as one memory; this is the structured half.
 */
export async function learnFromJob(
  ctx: ToolContext,
  input: { job: OneOffJob; body: string; routing: Routing; toolsUsed: string[]; failures: string[] },
): Promise<{ stored: number; note?: string }> {
  const { getConfiguredProvider } = await import("../provider");
  const { recordAgentMemory } = await import("../../tools/recordAgentMemory");
  const { recordLesson } = await import("../lessonMemory");
  const { job, body, routing } = input;
  const domain = domainForAgent(job.agentId);

  let items: Array<{ kind: string; text: string }> = [];
  try {
    const provider = await getConfiguredProvider();
    const resp = await provider.complete({
      system: EXTRACT_SYSTEM_PROMPT,
      userMessage: `REQUEST:\n${job.prompt}\n\nLINKS: ${job.links.join(", ") || "none"}\n\nFINAL ANSWER:\n${body}`,
      tools: [],
      timeoutMs: 40_000,
      maxTokens: 2048,
    });
    items = resp.kind === "text" ? parseMemoryItems(resp.text) : [];
  } catch {
    items = [];
  }

  let stored = 0;
  for (const it of items) {
    const r = await recordAgentMemory(ctx, {
      projectId: TARGET_PROJECT_ID,
      kind: `one_off_${it.kind}`,
      domain,
      content: it.text,
      metadata: { jobId: job.jobId, agentId: job.agentId, topic: routing.topic, farm: routing.farm, links: job.links },
    });
    if (r.ok) stored++;
  }

  await recordLesson(ctx, {
    agentId: job.agentId,
    actionName: oneOffTaskKey(job.agentId),
    projectId: TARGET_PROJECT_ID,
    domain,
    outcomeSummary:
      `Request: ${job.prompt.slice(0, 600)}\n` +
      `Tools used: ${input.toolsUsed.join(", ") || "none"}\n` +
      `Problems: ${input.failures.join("; ") || "none"}\n` +
      `Answer (start): ${body.slice(0, 1200)}`,
  });

  return { stored };
}
