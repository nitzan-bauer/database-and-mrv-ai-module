import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "../scheduledTasks/constants";
import {
  buildTaskPrompt,
  domainForAgent,
  oneOffTaskKey,
  parseRoutingBlock,
  fitWorkLog,
  reportTitleFor,
  requestNeedsLookup,
  subjectFor,
  unopenedLinks,
  urlsInToolInput,
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
const MAX_RECALL_CALLS = 2;

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
  // Drive folders named in the request are read by the system, up front (see readDriveFolders.ts).
  const { readDriveFolders } = await import("./readDriveFolders");
  const drive = await readDriveFolders(ctx.googleAccessToken, job.driveFolders);
  const basePrompt = buildTaskPrompt({
    prompt: job.prompt,
    links: job.links,
    attachments: job.attachments,
    chromeDomains: job.chromeDomains,
    driveDocs: drive.docs,
    driveNotes: drive.notes,
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
    // Research steps get an index of the Drive files; the final answer gets the excerpts.
    driveDocs: drive.docs.map((d) => ({ name: d.name, text: `${d.text.slice(0, 300)}…` })),
    driveNotes: drive.notes,
  });

  const { recallForJob } = await import("./recall");
  const recalled = await recallForJob(ctx, job.agentId, job.prompt);
  await appendProgress(jobId, {
    at: new Date().toISOString(),
    step: 0,
    tool: "recall",
    summary: `Recalled ${recalled.lessons} lesson(s) and ${recalled.memories} stored note(s) before starting.`,
  });
  if (job.driveFolders.length) {
    await appendProgress(jobId, {
      at: new Date().toISOString(),
      step: 0,
      tool: "drive_folders",
      summary: clip(drive.notes.join(" "), 280),
    });
  }

  const started = Date.now();
  let workLog = "";
  const logEntries: string[] = [];
  const addLog = (text: string) => {
    logEntries.push(text);
    workLog = fitWorkLog(logEntries, WORK_LOG_CHAR_LIMIT);
  };
  const opened = new Set<string>();
  let recallCalls = 0;
  let linksPushedBack = false;
  let finalText: string | null = null;
  const toolsUsed: string[] = [];
  const failures: string[] = [];
  let pushedBack = false;

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
          addLog(`\nStep ${step}: the model call ran out of time; no further research this run.\n`);
          break;
        }
        throw e;
      }

      if (resp.kind === "text") {
        const t = resp.text.trim();
        // The request names a site/link and no tool has been used: that is not research, it is skipping it. Send her
        // back once (a reply like "I could not access Verra" without a single call was seen live, 2026-11-02).
        if (!toolsUsed.length && !pushedBack && requestNeedsLookup(job.prompt, job.links.length > 0)) {
          pushedBack = true;
          addLog(
            `\nStep ${step}: you replied without opening any site or link named in the request. Open it now with ` +
              `fetch_public_url, browse_website or search_verra_registry. Do not claim you could not access a source you did not try.\n`,
          );
          await appendProgress(jobId, {
            at: new Date().toISOString(),
            step,
            tool: null,
            summary: "Sent back to open the sites named in the request before answering.",
          });
          continue;
        }
        // Links listed in the request that nothing has been pointed at yet: send her back once to open them
        // (seen live: the revision page and the FAQ were listed, and never opened).
        const missing = unopenedLinks(job.links, opened);
        if (missing.length && !linksPushedBack && left > 25_000) {
          linksPushedBack = true;
          addLog(
            `\nStep ${step}: these links from the request have NOT been opened yet: ${missing.join(", ")}. Open each of them now ` +
              `(browse_chrome_session if its site is allowed, otherwise fetch_public_url) before you finish.\n`,
          );
          await appendProgress(jobId, {
            at: new Date().toISOString(),
            step,
            tool: null,
            summary: `Sent back to open ${missing.length} link(s) from the request that were not opened yet.`,
          });
          continue;
        }
        if (t.length < 40 && /^READY\b/i.test(t)) break; // research done — the final answer comes from its own call
        finalText = t;
        await appendProgress(jobId, { at: new Date().toISOString(), step, tool: null, summary: "Wrote the final answer." });
        break;
      }

      const name = resp.call.name;
      const entry = TOOL_REGISTRY[name];
      if (!entry || !agent.tools.includes(name)) {
        addLog(`\nStep ${step}: you tried "${name}", which you do not hold. Use only your own tools.\n`);
        continue;
      }

      // Memory was already recalled before the run began; repeated recall calls burned five of eight steps live.
      if (name === "recall_agent_memory" && ++recallCalls > MAX_RECALL_CALLS) {
        addLog(
          `\nStep ${step}: no more memory recalls this run (your memory was loaded at the start and ${MAX_RECALL_CALLS} recalls ` +
            `were used). Use browse_chrome_session / fetch_public_url on the links in the request instead.\n`,
        );
        continue;
      }
      for (const u of urlsInToolInput(resp.call.input)) opened.add(u);

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
      addLog(`\nStep ${step}: ${summary}\n`);
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
    reportTitle: reportTitleFor(job.prompt),
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
