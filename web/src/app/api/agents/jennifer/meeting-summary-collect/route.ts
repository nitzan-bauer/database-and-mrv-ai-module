import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The heavy half of jennifer_weekly_meeting_summary — downloading a
 * meeting recording, re-encoding it, transcribing it, and summarizing it
 * in Hebrew — moved out of the Vercel cron entirely, into
 * .github/workflows/jennifer-meeting-summary-collect.yml, the same way
 * rebeka_webinar_recording_summary already runs on GitHub Actions instead
 * of Vercel.
 *
 * Confirmed live 2026-09-02: a real ~36-minute meeting alone produces a
 * recording that, downloaded + re-encoded + transcribed + summarized +
 * emailed inside one Vercel function, exceeds even the Hobby plan's
 * maxDuration ceiling (60s, no higher tier available without a paid
 * upgrade) — a platform limit, not a bug fixable by more code running
 * inside that same function. GitHub Actions' 30-minute job timeout has
 * comfortable headroom for the same work.
 *
 * jenniferWeeklyMeetingCycle.ts/jenniferMeetingSummary.ts still owns
 * SCHEDULING the next occurrence's Recall bot (cheap, no audio handling)
 * — this route only owns COLLECTING a past occurrence once its bot is
 * done.
 */

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.EXTERNAL_AGENT_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { query } = await import("@/lib/db");
  const pending = await query<{ summary_id: string; meeting_date: string; bot_id: string | null }>(
    `SELECT summary_id, meeting_date::text, bot_id FROM mrv.jennifer_meeting_summaries
      WHERE status IN ('scheduled', 'recording') AND meeting_date <= now()::date AND bot_id IS NOT NULL
      ORDER BY meeting_date`,
  );
  return NextResponse.json({ pending });
}

interface RequestBody {
  summaryId: string;
  result: "still_waiting" | "failed" | "ready";
  failureReason?: string;
  /** One paragraph per array entry, in Hebrew — required when result === "ready". */
  paragraphs?: string[];
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
  if (!body.summaryId?.trim()) return NextResponse.json({ error: "summaryId is required" }, { status: 400 });

  const { query } = await import("@/lib/db");

  const rows = await query<{ meeting_date: string }>(
    `SELECT meeting_date::text FROM mrv.jennifer_meeting_summaries WHERE summary_id = $1`,
    [body.summaryId],
  );
  if (!rows.length) return NextResponse.json({ error: "no such summaryId" }, { status: 404 });
  const meetingDate = rows[0].meeting_date;

  if (body.result === "still_waiting") {
    await query(`UPDATE mrv.jennifer_meeting_summaries SET status = 'recording', updated_at = clock_timestamp() WHERE summary_id = $1`, [
      body.summaryId,
    ]);
    return NextResponse.json({ ok: true, detail: `Meeting ${meetingDate}: still recording/processing, not ready yet.` });
  }

  if (body.result === "failed") {
    await query(`UPDATE mrv.jennifer_meeting_summaries SET status = 'failed', failure_reason = $2, updated_at = clock_timestamp() WHERE summary_id = $1`, [
      body.summaryId,
      body.failureReason ?? "unknown failure",
    ]);
    await query(
      `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
       VALUES ('jennifer', 'run_scheduled_task', 'scheduled_task', NULL, $1::jsonb)`,
      [JSON.stringify({ taskKey: "jennifer_meeting_summary_collect", triggeredBy: "external_routine", status: "error", detail: body.failureReason })],
    );
    return NextResponse.json({ ok: true, detail: `Meeting ${meetingDate}: failed — ${body.failureReason ?? "unknown failure"}` });
  }

  if (!body.paragraphs?.length) return NextResponse.json({ error: "paragraphs is required when result is 'ready'" }, { status: 400 });

  const { agentSenderEmail } = await import("@/lib/agent/agentEmailAliases");
  const { getServiceGoogleAccessToken } = await import("@/lib/google/serviceAuth");
  const { sendGmailMessage } = await import("@/lib/google/gmailClient");

  const NOTIFY_TO = "nitzan@carbonature.io, elad@carbonature.io";
  const serviceEmail = process.env.CRON_GOOGLE_ACCOUNT_EMAIL?.trim() || "nitzan@carbonature.io";
  const googleAccessToken = await getServiceGoogleAccessToken(query, serviceEmail);
  const summaryText = body.paragraphs.join("\n\n");

  if (googleAccessToken) {
    await sendGmailMessage(googleAccessToken, {
      to: NOTIFY_TO,
      from: agentSenderEmail("jennifer"),
      subject: `סיכום פגישה שבועית — ${meetingDate}`,
      bodyText: summaryText,
    });
  }

  await query(
    `UPDATE mrv.jennifer_meeting_summaries SET status = 'sent', summary_text = $2, updated_at = clock_timestamp() WHERE summary_id = $1`,
    [body.summaryId, summaryText],
  );
  await query(
    `INSERT INTO mrv.audit_log (actor, action, target_type, target_id, payload)
     VALUES ('jennifer', 'run_scheduled_task', 'scheduled_task', NULL, $1::jsonb)`,
    [JSON.stringify({ taskKey: "jennifer_meeting_summary_collect", triggeredBy: "external_routine", status: "ok", detail: `emailed to ${NOTIFY_TO}` })],
  );

  return NextResponse.json({
    ok: true,
    detail: googleAccessToken
      ? `Meeting ${meetingDate}: summarized and emailed to ${NOTIFY_TO}.`
      : `Meeting ${meetingDate}: summarized (no Google access token available — not emailed).`,
  });
}
