import { NextResponse } from "next/server";
import { TARGET_PROJECT_ID } from "@/lib/agent/scheduledTasks/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one entry point the external Verra-webinar-recording routine posts
 * into (Nitzan's own spec, this session: download the recording, transcribe
 * it with Groq, summarize it, then reuse Rebeka's existing email/memory/DB
 * infrastructure — not a second implementation of it). That routine runs in
 * an isolated Anthropic cloud sandbox with no DB, Gmail, or Drive
 * credentials of its own, so it can only reach this app the same way
 * Vercel Cron does: a bearer secret, fail-closed exactly like
 * /api/cron/run-scheduled-tasks.
 *
 * Everything after auth is a thin wrapper around finishScheduledTask — the
 * same function every one of Rebeka's 5 existing scheduled tasks already
 * ends on, so this report gets the identical letterhead PDF, memory write,
 * and mrv.scheduled_task_reports row as a locally-run task, not a
 * lookalike.
 */

interface RequestBody {
  /** Verra's own title for the webinar/session, used as the email subject. */
  subject: string;
  /** One paragraph per array entry — the transcript-based summary itself. */
  bodyParagraphs: string[];
  /** The recording page or video URL the summary was produced from. */
  sourceUrl?: string;
  /** Set by the routine when it decided the recording was NOT VM0042/ALM and skipped summarizing it. */
  skippedReason?: string;
}

/**
 * Lets the routine dedupe before spending a Groq transcription call: Verra's
 * recordings page is a rolling list, so without this the routine would
 * re-summarize (and re-email) the same past recording on every weekly run.
 * Returns the last 90 days of subjects/URLs this endpoint already recorded
 * for the routine to compare against, not a full transcript re-fetch.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.EXTERNAL_AGENT_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { query } = await import("@/lib/db");
  // emailed = true only, deliberately — a skip/failure record (unresolved
  // video URL, download error, etc.) must NOT count as "already done", or
  // one transient failure permanently blocks ever retrying that recording.
  // Confirmed live 2026-08-25: without this filter, a resolve-URL failure
  // on the routine's first run made the very next run's dedupe check treat
  // the same still-unsummarized recording as already handled.
  const rows = await query<{ subject: string; body_text: string; created_at: string }>(
    `SELECT subject, body_text, created_at FROM mrv.scheduled_task_reports
      WHERE task_key = 'rebeka_webinar_recording_summary' AND emailed = true AND created_at > now() - interval '90 days'
      ORDER BY created_at DESC LIMIT 20`,
  );
  return NextResponse.json({
    alreadyProcessed: rows.map((r) => ({
      subject: r.subject,
      createdAt: r.created_at,
      sourceUrl: /Source recording: (\S+)/.exec(r.body_text)?.[1] ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.EXTERNAL_AGENT_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.subject?.trim()) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }

  const taskKey = "rebeka_webinar_recording_summary";

  // The routine screened the recording itself and found it out of scope
  // (not VM0042/ALM) — record that it ran and why, but there is nothing
  // worth emailing.
  if (body.skippedReason) {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO mrv.scheduled_task_reports (task_key, project_id, subject, body_text, emailed)
       VALUES ($1, $2, $3, $4, false)`,
      [taskKey, TARGET_PROJECT_ID, body.subject, body.skippedReason],
    );
    return NextResponse.json({ ok: true, detail: `Recorded, not emailed — ${body.skippedReason}` });
  }

  if (!body.bodyParagraphs?.length) {
    return NextResponse.json({ error: "bodyParagraphs is required unless skippedReason is set" }, { status: 400 });
  }

  const { query } = await import("@/lib/db");
  const { getServiceGoogleAccessToken } = await import("@/lib/google/serviceAuth");
  const { finishScheduledTask } = await import("@/lib/reports/scheduledTaskReport");

  const serviceEmail = process.env.CRON_GOOGLE_ACCOUNT_EMAIL?.trim() || "nitzan@carbonature.io";
  const googleAccessToken = (await getServiceGoogleAccessToken(query, serviceEmail)) ?? undefined;

  const paragraphs = body.sourceUrl
    ? [...body.bodyParagraphs, `Source recording: ${body.sourceUrl}`]
    : body.bodyParagraphs;

  const outcome = await finishScheduledTask(
    { actor: "rebeka", actorKind: "agent", googleAccessToken },
    {
      taskKey,
      projectId: TARGET_PROJECT_ID,
      subject: body.subject,
      bodyParagraphs: paragraphs,
      memoryKind: "verra_webinar_transcript_summary",
      agentId: "rebeka",
    },
  );

  await query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
     VALUES ('rebeka', 'run_scheduled_task', 'scheduled_task', NULL, $1::jsonb)`,
    [JSON.stringify({ taskKey, triggeredBy: "external_routine", status: outcome.ok ? "ok" : "error", detail: outcome.detail })],
  );

  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}
