import "server-only";
import type { JobAttachment } from "./jobInput";

export type JobStatus = "queued" | "running" | "done" | "needs_approval" | "error";

export interface ProgressEntry {
  at: string;
  step: number;
  tool: string | null;
  summary: string;
}

export interface OneOffJob {
  jobId: string;
  agentId: string;
  requestedBy: string;
  prompt: string;
  links: string[];
  attachments: JobAttachment[];
  chromeDomains: string[];
  /** Drive folder ids the request asked the agent to read. */
  driveFolders: string[];
  status: JobStatus;
  progress: ProgressEntry[];
  resultText: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function rowToJob(r: Record<string, unknown>): OneOffJob {
  return {
    jobId: String(r.job_id),
    agentId: String(r.agent_id),
    requestedBy: String(r.requested_by),
    prompt: String(r.prompt),
    links: (r.links as string[]) ?? [],
    attachments: (r.attachments as JobAttachment[]) ?? [],
    chromeDomains: (r.chrome_domains as string[]) ?? [],
    driveFolders: (r.drive_folders as string[]) ?? [],
    status: r.status as JobStatus,
    progress: (r.progress as ProgressEntry[]) ?? [],
    resultText: (r.result_text as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    finishedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
  };
}

export async function createJob(input: {
  agentId: string;
  requestedBy: string;
  prompt: string;
  links: string[];
  attachments: JobAttachment[];
  chromeDomains: string[];
  driveFolders: string[];
}): Promise<string> {
  const { query } = await import("../../db");
  const rows = await query<{ job_id: string }>(
    `INSERT INTO mrv.adhoc_agent_jobs (agent_id, requested_by, prompt, links, attachments, chrome_domains, drive_folders)
     VALUES ($1, $2, $3, $4::text[], $5::jsonb, $6::text[], $7::text[]) RETURNING job_id`,
    [
      input.agentId,
      input.requestedBy,
      input.prompt,
      input.links,
      JSON.stringify(input.attachments),
      input.chromeDomains,
      input.driveFolders,
    ],
  );
  return rows[0].job_id;
}

export async function getJob(jobId: string): Promise<OneOffJob | null> {
  const { query } = await import("../../db");
  const rows = await query<Record<string, unknown>>(`SELECT * FROM mrv.adhoc_agent_jobs WHERE job_id = $1`, [jobId]);
  return rows.length ? rowToJob(rows[0]) : null;
}

/** Only a 'queued' job may start — a second trigger for the same job is a no-op, never a double run. */
export async function markRunning(jobId: string): Promise<boolean> {
  const { query } = await import("../../db");
  const rows = await query<{ job_id: string }>(
    `UPDATE mrv.adhoc_agent_jobs SET status = 'running', started_at = clock_timestamp()
      WHERE job_id = $1 AND status = 'queued' RETURNING job_id`,
    [jobId],
  );
  return rows.length === 1;
}

export async function appendProgress(jobId: string, entry: ProgressEntry): Promise<void> {
  const { query } = await import("../../db");
  await query(`UPDATE mrv.adhoc_agent_jobs SET progress = progress || $2::jsonb WHERE job_id = $1`, [
    jobId,
    JSON.stringify([entry]),
  ]);
}

export async function finishJob(
  jobId: string,
  outcome: { status: "done" | "needs_approval" | "error"; resultText?: string; error?: string },
): Promise<void> {
  const { query } = await import("../../db");
  await query(
    `UPDATE mrv.adhoc_agent_jobs
        SET status = $2, result_text = $3, error = $4, finished_at = clock_timestamp()
      WHERE job_id = $1`,
    [jobId, outcome.status, outcome.resultText ?? null, outcome.error ?? null],
  );
  // Page text read from a signed-in session is not kept once the job is over.
  await query(`UPDATE mrv.browser_requests SET result_text = NULL WHERE job_id = $1`, [jobId]);
}
