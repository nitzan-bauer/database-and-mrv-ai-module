"use server";

import { headers } from "next/headers";
import { auth } from "@/auth";
import { DATA_MODE } from "@/lib/env";
import { normalizeDomains } from "./chromeAllow";
import {
  capAttachments,
  domainForAgent,
  MAX_DRIVE_FOLDERS,
  normalizeLinks,
  oneOffTaskKey,
  parseDriveFolderId,
  ONE_OFF_AGENT_IDS,
  type JobAttachment,
} from "./jobInput";
import type { OneOffJob } from "./jobStore";

// The one project every agent's scheduled work and lessons are scoped to (scheduledTasks/constants.ts is server-only).
const TARGET_PROJECT_ID = "CARBO-3988";

export type StartOneOffResult = { ok: true; jobId: string; notes: string[] } | { ok: false; error: string };

export async function startOneOffJobAction(input: {
  agentId: string;
  prompt: string;
  links: string[];
  attachments: JobAttachment[];
  chromeDomains: string[];
  /** Pasted Drive folder links (or ids). */
  driveFolders: string[];
}): Promise<StartOneOffResult> {
  if (DATA_MODE !== "db") return { ok: false, error: "One-off tasks need the database." };
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Sign in to run a task." };
  if (!(ONE_OFF_AGENT_IDS as readonly string[]).includes(input.agentId)) return { ok: false, error: "Unknown agent." };

  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Write what you want the agent to do." };
  if (prompt.length > 8000) {
    return { ok: false, error: "The request is longer than 8,000 characters — shorten it or attach it as a file." };
  }

  const { links, rejected } = normalizeLinks(input.links);
  const { attachments, droppedNames } = capAttachments(input.attachments);
  const chromeDomains = normalizeDomains(input.chromeDomains);
  const driveFolders: string[] = [];
  for (const raw of input.driveFolders) {
    const parsed = parseDriveFolderId(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (!driveFolders.includes(parsed.id)) driveFolders.push(parsed.id);
  }
  if (driveFolders.length > MAX_DRIVE_FOLDERS) {
    return { ok: false, error: `At most ${MAX_DRIVE_FOLDERS} Drive folders per task.` };
  }
  const notes = [
    ...(rejected.length ? [`Ignored ${rejected.length} link(s) that are not valid http(s) URLs or exceed the limit.`] : []),
    ...(droppedNames.length ? [`Skipped ${droppedNames.join(", ")} — over the total attachment size limit.`] : []),
  ];

  const secret = process.env.EXTERNAL_AGENT_SECRET;
  if (!secret) return { ok: false, error: "EXTERNAL_AGENT_SECRET is not configured — cannot start the run." };

  const { createJob, finishJob } = await import("./jobStore");
  const jobId = await createJob({
    agentId: input.agentId,
    requestedBy: email,
    prompt,
    links,
    attachments,
    chromeDomains,
    driveFolders,
  });

  // Call the long-running route on the same host the person is using (works on localhost:3007 and in production).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3007";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const res = await fetch(`${proto}://${host}/api/agents/one-off/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ jobId, requestedBy: email }),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error || !res.ok) {
    const why = res instanceof Error ? res.message : `HTTP ${res.status}`;
    await finishJob(jobId, { status: "error", error: `Could not start the run (${why}).` });
    return { ok: false, error: `Could not start the run (${why}).` };
  }
  return { ok: true, jobId, notes };
}

export async function getOneOffJobAction(jobId: string): Promise<OneOffJob | null> {
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return null;
  const { getJob } = await import("./jobStore");
  return getJob(jobId);
}

/**
 * Nitzan's verdict on a finished task. Written as a real human verdict (mrv.agent_feedback — recordAgentFeedback is
 * human-only by design), and — for a correction or a rejection — immediately distilled into a lesson, so the next
 * one-off task's recall already carries it. This is the "the agent improves from every task" half that a model
 * cannot do on its own.
 */
export async function rateOneOffJobAction(input: {
  jobId: string;
  verdict: "approved" | "corrected" | "rejected";
  correctionText?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Sign in to rate a task." };

  const { getJob } = await import("./jobStore");
  const job = await getJob(input.jobId);
  if (!job || job.status !== "done") return { ok: false, error: "Only a finished task can be rated." };

  const correction = input.correctionText?.trim() ?? "";
  if (input.verdict !== "approved" && !correction) {
    return { ok: false, error: "Say what was wrong, or what the agent should do differently." };
  }

  const { recordAgentFeedback } = await import("@/lib/tools/recordAgentFeedback");
  const saved = await recordAgentFeedback(
    { actor: email, actorKind: "human" },
    {
      agentId: job.agentId,
      actionName: oneOffTaskKey(job.agentId),
      targetType: "adhoc_agent_job",
      targetId: job.jobId,
      verdict: input.verdict,
      correctionText: correction || null,
    },
  );
  if (!saved.ok) return { ok: false, error: saved.error };

  if (input.verdict !== "approved") {
    const { recordLesson } = await import("@/lib/agent/lessonMemory");
    await recordLesson(
      { actor: job.agentId, actorKind: "agent" },
      {
        agentId: job.agentId,
        actionName: oneOffTaskKey(job.agentId),
        projectId: TARGET_PROJECT_ID,
        domain: domainForAgent(job.agentId),
        outcomeSummary:
          `Request: ${job.prompt.slice(0, 600)}\n` +
          `My answer (start): ${(job.resultText ?? "").slice(0, 1000)}\n` +
          `Nitzan's verdict: ${input.verdict} — ${correction}`,
      },
    );
  }
  return { ok: true };
}
