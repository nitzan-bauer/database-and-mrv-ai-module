import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same ceiling as the cron route (verified there against Vercel's Fluid-compute limits): the work runs inside
// after(), so it is this route's budget — not the 60 s of the agent pages — that bounds an agent's one-off task.
export const maxDuration = 280;

/**
 * Starts the actual run of one agent's one-off task. Called server-to-server by startOneOffJobAction with
 * EXTERNAL_AGENT_SECRET (the same secret the sibling /api/agents/* routes use); answers 202 at once and does the
 * work in after(), through runScheduledTaskNow so last_run_* and the audit log are written exactly as for any
 * other scheduled task.
 */
export async function POST(req: Request) {
  const expected = process.env.EXTERNAL_AGENT_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { jobId?: string; requestedBy?: string } | null;
  if (!body?.jobId || !/^[0-9a-f-]{36}$/i.test(body.jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  const jobId = body.jobId;
  const requestedBy = body.requestedBy ?? "unknown";

  const { query } = await import("@/lib/db");
  const jobs = await query<{ agent_id: string; status: string }>(
    `SELECT agent_id, status FROM mrv.adhoc_agent_jobs WHERE job_id = $1`,
    [jobId],
  );
  if (!jobs.length) return NextResponse.json({ error: "no such job" }, { status: 404 });
  if (jobs[0].status !== "queued") {
    return NextResponse.json({ accepted: false, reason: `job is ${jobs[0].status}` }, { status: 200 });
  }
  const agentId = jobs[0].agent_id;

  after(async () => {
    const { oneOffTaskKey } = await import("@/lib/agent/oneOff/jobInput");
    const { runScheduledTaskNow } = await import("@/lib/agent/runScheduledTaskNow");
    const taskKey = oneOffTaskKey(agentId);
    const rows = await query<{ task_id: string; frequency: string; next_run_at: string }>(
      `SELECT task_id, frequency, next_run_at FROM mrv.scheduled_tasks WHERE task_key = $1`,
      [taskKey],
    );
    if (!rows.length) {
      const { finishJob } = await import("@/lib/agent/oneOff/jobStore");
      await finishJob(jobId, { status: "error", error: `No scheduled task "${taskKey}" — run migration 0128.` });
      return;
    }
    const r = rows[0];
    await runScheduledTaskNow(
      { taskId: r.task_id, agentId, taskKey, frequency: r.frequency, nextRunAt: r.next_run_at },
      `manual:${requestedBy}`,
      { jobId },
    );
  });

  return NextResponse.json({ accepted: true, jobId }, { status: 202 });
}
