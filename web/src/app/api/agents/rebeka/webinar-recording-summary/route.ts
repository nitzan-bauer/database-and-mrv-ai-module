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
  /** Set by the routine when it decided the recording was NOT VM0042/ALM and skipped summarizing it, or when a candidate genuinely failed to process. */
  skippedReason?: string;
  /**
   * True only for a skippedReason that Nitzan should actually see — a real
   * processing failure on an in-scope recording (unresolved video URL,
   * download error, transcription error), not the routine weekly no-op of
   * "nothing new this week." Without this distinction every skip would
   * either spam an email for a normal empty week, or every real failure
   * would sit silently in the DB where nobody would think to look for it.
   */
  notifyOnSkip?: boolean;
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
  //
  // That filter alone isn't enough: the "we couldn't process this, here's
  // why" notice this route itself emails Nitzan (subject prefixed "Action
  // needed — ") reuses the webinar's own title and IS emailed = true —
  // confirmed live 2026-09-02, this made the 2026-08-25 YouTube-blocked
  // webinar permanently look "already summarized" even though no summary
  // was ever produced. Excluded by subject prefix, the one thing that
  // reliably tells a failure notice apart from a real summary.
  const rows = await query<{ subject: string; body_text: string; created_at: string }>(
    `SELECT subject, body_text, created_at FROM mrv.scheduled_task_reports
      WHERE task_key = 'rebeka_webinar_recording_summary' AND emailed = true AND created_at > now() - interval '90 days'
        AND subject NOT LIKE 'Action needed — %'
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

  // A routine no-op ("nothing new/relevant this week") is recorded but not
  // emailed — that's the expected outcome most weeks and would just be
  // noise. A real per-candidate failure (notifyOnSkip) is worth Nitzan
  // actually seeing, so it goes through the normal email path below
  // instead of a silent DB-only row (confirmed live 2026-08-25: without
  // this, a real failure — e.g. YouTube blocking the download — sat in
  // the database with nothing ever surfacing it to him).
  if (body.skippedReason && !body.notifyOnSkip) {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO mrv.scheduled_task_reports (task_key, project_id, subject, body_text, emailed)
       VALUES ($1, $2, $3, $4, false)`,
      [taskKey, TARGET_PROJECT_ID, body.subject, body.skippedReason],
    );
    return NextResponse.json({ ok: true, detail: `Recorded, not emailed — ${body.skippedReason}` });
  }

  if (body.skippedReason && body.notifyOnSkip) {
    const { query } = await import("@/lib/db");
    const { getServiceGoogleAccessToken } = await import("@/lib/google/serviceAuth");
    const { finishScheduledTask } = await import("@/lib/reports/scheduledTaskReport");
    const serviceEmail = process.env.CRON_GOOGLE_ACCOUNT_EMAIL?.trim() || "nitzan@carbonature.io";
    const googleAccessToken = (await getServiceGoogleAccessToken(query, serviceEmail)) ?? undefined;

    const outcome = await finishScheduledTask(
      { actor: "rebeka", actorKind: "agent", googleAccessToken },
      {
        taskKey,
        projectId: TARGET_PROJECT_ID,
        subject: `Action needed — ${body.subject}`,
        bodyParagraphs: [body.skippedReason],
        memoryKind: "verra_webinar_transcript_summary",
        agentId: "rebeka",
      },
    );
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
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
