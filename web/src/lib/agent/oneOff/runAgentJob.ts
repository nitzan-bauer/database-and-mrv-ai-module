import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import {
  buildTaskPrompt,
  domainForAgent,
  oneOffTaskKey,
  parseRoutingBlock,
  subjectFor,
  topicFolderPath,
} from "./jobInput";
import { appendProgress, finishJob, getJob, markRunning } from "./jobStore";

// Tool steps (research) stop at 100 s. The final answer then gets its OWN tool-free call with a guaranteed 75 s —
// with attached files the answer alone can take 40 s+, and it used to be starved by whatever research had left
// over. The wrap-up (letterhead report ≈ 25 s, then memory + Drive filing in parallel ≈ 60 s) follows, all inside
// runScheduledTaskNow's handler cap.
const MAX_STEPS = 8;
const TOOL_PHASE_MS = 100_000;
const STEP_TIMEOUT_MS = 55_000;
const SYNTHESIS_TIMEOUT_MS = 75_000;
const RESEARCH_ATTACHMENT_CHARS = 8_000;
const WORK_LOG_CHAR_LIMIT = 12_000;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… [clipped]` : s;
}

/**
 * One one-off task for one agent (any of the five): a bounded multi-step loop over that agent's OWN tools.
 * Each tool call goes through the same entry.handler runAgentTask uses, so checkPolicy/audit apply unchanged;
 * a confirm-mode tool stops the job and lands in /agents/approvals instead of running.
 * runAgentTask itself is single-step by design and the provider takes one message, so the loop re-prompts with
 * an accumulating "work so far" log instead of changing either.
 */
export async function runAgentJob(ctx: ToolContext, jobId: string): Promise<ScheduledTaskOutcome> {
  const job = await getJob(jobId);
  if (!job) return { ok: false, detail: `No one-off job ${jobId}.` };
  if (!(await markRunning(jobId))) {
    return { ok: false, detail: `Job ${jobId} is already ${job.status} — not started twice.` };
  }

  const { getAgent } = await import("../../data");
  const { getConfiguredProvider } = await import("../provider");
  const { TOOL_REGISTRY } = await import("../toolRegistry");
  const agent = await getAgent(job.agentId);
  if (!agent) {
    await finishJob(jobId, { status: "error", error: `No such agent: ${job.agentId}` });
    return { ok: false, detail: `No such agent: ${job.agentId}` };
  }

  const taskKey = oneOffTaskKey(job.agentId);
  const domain = domainForAgent(job.agentId);
  const provider = await getConfiguredProvider();
  const schemas = agent.tools
    .map((name) => TOOL_REGISTRY[name]?.schema)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const basePrompt = buildTaskPrompt({
    prompt: job.prompt,
    links: job.links,
    attachments: job.attachments,
    chromeDomains: job.chromeDomains,
  });

  // The prompt is re-sent on every research step, so attached files are clipped there (the model only needs the
  // gist to decide what to look up); the final-answer call gets them in full.
  const researchPrompt = buildTaskPrompt({
    prompt: job.prompt,
    links: job.links,
    attachments: job.attachments.map((a) =>
      a.text.length > RESEARCH_ATTACHMENT_CHARS
        ? { name: a.name, text: a.text.slice(0, RESEARCH_ATTACHMENT_CHARS), truncated: true }
        : a,
    ),
    chromeDomains: job.chromeDomains,
  });

  const { recallForJob } = await import("./recall");
  const recalled = await recallForJob(ctx, job.agentId, job.prompt);
  await appendProgress(jobId, {
    at: new Date().toISOString(),
    step: 0,
    tool: "recall",
    summary: `Recalled ${recalled.lessons} lesson(s) and ${recalled.memories} stored note(s) before starting.`,
  });

  const started = Date.now();
  let workLog = "";
  let finalText: string | null = null;
  const toolsUsed: string[] = [];
  const failures: string[] = [];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const left = TOOL_PHASE_MS - (Date.now() - started);
      if (left < 10_000) break;

      const userMessage =
        (workLog
          ? `${researchPrompt}\n\n--- WORK SO FAR (your own earlier steps this run) ---\n${workLog}\n\n`
          : `${researchPrompt}\n\n`) +
        `RESEARCH STEP: call ONE tool if you still need information. If you already have enough, reply with the single word READY — ` +
        `the full answer is written in a separate final step, so do not write it here.`;

      let resp: Awaited<ReturnType<typeof provider.complete>>;
      try {
        resp = await provider.complete({
          system: agent.rolePrompt + recalled.block,
          userMessage,
          tools: schemas,
          webSearch: { maxUses: 3, timeoutMs: Math.min(STEP_TIMEOUT_MS, left) },
          timeoutMs: Math.min(STEP_TIMEOUT_MS, left),
          maxTokens: 8192,
        });
      } catch (e) {
        // A slow research step is not a failed task: keep what was gathered and go straight to the final answer.
        if (e instanceof Error && /timed out/i.test(e.message)) {
          workLog += `\nStep ${step}: the model call ran out of time; no further research this run.\n`;
          break;
        }
        throw e;
      }

      if (resp.kind === "text") {
        const t = resp.text.trim();
        if (t.length < 40 && /^READY\b/i.test(t)) break; // research done — the final answer comes from its own call
        finalText = t;
        await appendProgress(jobId, { at: new Date().toISOString(), step, tool: null, summary: "Wrote the final answer." });
        break;
      }

      const name = resp.call.name;
      const entry = TOOL_REGISTRY[name];
      if (!entry || !agent.tools.includes(name)) {
        workLog += `\nStep ${step}: you tried "${name}", which you do not hold. Use only your own tools.\n`;
        continue;
      }

      const result = await entry.handler(ctx, resp.call.input);
      if (!result.ok && result.needsConfirmation) {
        const { query } = await import("../../db");
        await query(
          `INSERT INTO mrv.pending_agent_actions (agent_id, action_name, input, reason, requested_by)
           VALUES ($1, $2, $3::jsonb, $4, $5)`,
          [job.agentId, name, JSON.stringify(resp.call.input), result.error, job.requestedBy],
        );
        await appendProgress(jobId, { at: new Date().toISOString(), step, tool: name, summary: `Held for approval: ${result.error}` });
        await finishJob(jobId, {
          status: "needs_approval",
          resultText: `Stopped at step ${step}: "${name}" needs a manager's approval (see /agents/approvals).${workLog ? "\n\nWork so far:\n" + clip(workLog, 3000) : ""}`,
        });
        return { ok: true, detail: `One-off task paused: ${name} awaits approval.` };
      }

      toolsUsed.push(name);
      if (!result.ok) failures.push(`${name}: ${clip(result.error, 200)}`);
      const summary = result.ok
        ? `${name} succeeded: ${clip(JSON.stringify(result.data), 1500)}`
        : `${name} failed: ${result.error}`;
      workLog = clip(`${workLog}\nStep ${step}: ${summary}\n`, WORK_LOG_CHAR_LIMIT);
      await appendProgress(jobId, { at: new Date().toISOString(), step, tool: name, summary: clip(summary, 300) });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishJob(jobId, { status: "error", error: message });
    return { ok: false, detail: `One-off task failed: ${message}` };
  }

  if (!finalText) {
    // Research is over (time or steps): write the answer from what was gathered, with no tools so it cannot start
    // another round, and with the full attachments still in view.
    try {
      const resp = await provider.complete({
        system: agent.rolePrompt + recalled.block,
        userMessage:
          `${basePrompt}\n\n--- WORK SO FAR (your own earlier steps this run) ---\n${workLog || "(none)"}\n\n` +
          `Research is done. Write the complete final answer for Nitzan NOW from the above — no tool calls. ` +
          `Be complete but tight (about 1,500 words at most). Say plainly what you could not verify or read.`,
        tools: [],
        timeoutMs: SYNTHESIS_TIMEOUT_MS,
        maxTokens: 4500,
        noThinking: true,
      });
      if (resp.kind === "text" && resp.text.trim()) {
        finalText = resp.text.trim();
        await appendProgress(jobId, { at: new Date().toISOString(), step: toolsUsed.length + 1, tool: null, summary: "Wrote the final answer." });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await finishJob(jobId, { status: "error", error: `${message}\n\nWork so far:\n${clip(workLog, 4000)}` });
      return { ok: false, detail: `One-off task failed: ${message}` };
    }
  }

  if (!finalText) {
    const partial = `The task did not reach a final answer within ${MAX_STEPS} steps / ${Math.round(TOOL_PHASE_MS / 1000)} s of research. Work so far:\n${clip(workLog, 4000)}`;
    await finishJob(jobId, { status: "error", error: partial });
    return { ok: false, detail: partial };
  }

  // The ROUTING line is for the filing step only — never shown, mailed or stored as part of the answer.
  const { body, routing } = parseRoutingBlock(finalText);
  await finishJob(jobId, { status: "done", resultText: body });

  // 1. Report: memory entry, lesson, DB row, letterhead PDF by email, PDF into the job's Drive folder.
  const folderPath = topicFolderPath(routing, job.prompt, job.createdAt);
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const report = await finishScheduledTask(ctx, {
    taskKey,
    projectId: TARGET_PROJECT_ID,
    subject: subjectFor(job.prompt, job.createdAt, job.jobId),
    bodyParagraphs: paragraphs,
    reportFormat: "docx",
    reportTitle: job.prompt.split("\n").find((l) => l.trim())?.trim().slice(0, 100),
    memoryKind: "one_off_task",
    agentId: job.agentId,
    domain,
    driveSubfolders: folderPath,
  });

  // 2. Learn and file, in parallel (they touch different things). Best-effort: a failure here is reported in the
  //    detail line but never costs the report that already went out.
  const { learnFromJob } = await import("./learnFromJob");
  const { fileJobToDrive } = await import("./fileJobToDrive");
  const [learned, filed] = await Promise.all([
    learnFromJob(ctx, { job, body, routing, toolsUsed, failures }).catch((e: unknown) => ({
      stored: 0,
      note: `memory step failed: ${e instanceof Error ? e.message : String(e)}`,
    })),
    fileJobToDrive(ctx, { job, body, routing, folderPath }).catch((e: unknown) => ({
      summary: `Drive filing failed: ${e instanceof Error ? e.message : String(e)}`,
    })),
  ]);
  return {
    ok: report.ok,
    detail: `${report.detail} Memory: ${learned.stored} item(s) stored. Drive: ${filed.summary}. (job ${jobId})`,
  };
}
