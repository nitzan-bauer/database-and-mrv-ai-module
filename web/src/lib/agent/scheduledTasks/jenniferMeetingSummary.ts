import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";
import { ymd, firstOccurrenceOnOrAfter } from "./dateHelpers";

export const TASK_KEY = "jennifer_weekly_meeting_summary";

/**
 * Nitzan's own spec: Jennifer "attends" the weekly work meeting and sends
 * him and Elad a real Hebrew summary — additive to jenniferWeeklyMeetingCycle
 * (which only handles the calendar/renewal side, never the meeting content).
 *
 * Google Meet's own "take notes"/transcript feature does not support
 * Hebrew (confirmed live 2026-08-25 against Google's own docs — English,
 * French, German, Italian, Japanese, Korean, Portuguese, Spanish only),
 * and this meeting is conducted in Hebrew — so a Recall.ai bot joins
 * instead and captures raw audio, which Groq Whisper (already proven
 * Hebrew-capable this session) transcribes and Claude summarizes.
 *
 * Two jobs each daily run, on the same 'active' meeting cycle from
 * jenniferWeeklyMeetingCycle.ts:
 *   1. SCHEDULE — an upcoming occurrence within the next few days with no
 *      summary row yet gets a Recall bot scheduled via join_at (Recall's
 *      own infrastructure handles exact-time joining, so this can run any
 *      time before the meeting, not right at the start).
 *   2. COLLECT — a past occurrence still 'scheduled'/'recording' gets
 *      polled; once the audio is ready, transcribe -> summarize -> email
 *      -> mark 'sent'. A bot that failed to join gets marked 'failed' and
 *      reported, never silently dropped.
 */

const MEETING_KEY = "weekly_work_meeting";
const NOTIFY_TO = "nitzan@carbonature.io, elad@carbonature.io";
const SCHEDULE_LOOKAHEAD_DAYS = 3; // schedule the bot up to this many days before the meeting
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // Groq's 25MB cap, with headroom

type CycleRow = {
  cycle_id: string;
  weekday: number;
  start_hour: number;
  start_minute: number;
  calendar_event_id: string;
  meet_link: string | null;
  cycle_start_date: string;
  cycle_end_date: string;
};

type SummaryRow = {
  summary_id: string;
  cycle_id: string;
  meeting_date: string;
  bot_id: string | null;
  status: "scheduled" | "recording" | "processing" | "sent" | "failed" | "skipped";
};

async function getOrCreateMeetLink(ctx: ToolContext, cycle: CycleRow): Promise<string> {
  if (cycle.meet_link) return cycle.meet_link;
  if (!ctx.googleAccessToken) throw new Error("no Google access token — cannot fetch/create the Meet link");
  const { query } = await import("../../db");
  const { getCalendarEventMeetLink, addMeetLinkToEvent } = await import("../../google/calendarClient");

  let link = await getCalendarEventMeetLink(ctx.googleAccessToken, cycle.calendar_event_id);
  if (!link) link = await addMeetLinkToEvent(ctx.googleAccessToken, cycle.calendar_event_id);

  await query(`UPDATE mrv.jennifer_meeting_cycles SET meet_link = $2, updated_at = clock_timestamp() WHERE cycle_id = $1`, [
    cycle.cycle_id,
    link,
  ]);
  return link;
}

const HEBREW_SUMMARY_SYSTEM =
  "אתה מסכם תמלול של פגישת עבודה שבועית בעברית, עבור שני המשתתפים בה. כתוב סיכום אמיתי — לא תרגום מילולי " +
  "ולא העתקה של קטעים מהתמלול — הכולל: הנושאים המרכזיים שנדונו, החלטות שהתקבלו, ומשימות/פעולות המשך אם צוינו " +
  "(עם שם האחראי אם נאמר). התבסס אך ורק על מה שנאמר בפועל בתמלול, אל תמציא פרטים. אם התמלול קצר מדי או לא " +
  'ברור, ציין זאת בכנות במקום לנחש. החזר אך ורק אובייקט JSON, בלי טקסט נוסף ובלי ```: {"paragraphs":[string, ...]}';

async function summarizeHebrew(transcript: string): Promise<string[]> {
  const { getConfiguredProvider } = await import("../provider");
  const provider = await getConfiguredProvider();
  const resp = await provider.complete({ system: HEBREW_SUMMARY_SYSTEM, userMessage: transcript.slice(0, 60_000), tools: [] });
  const raw = resp.kind === "text" ? resp.text : "";
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned) as { paragraphs?: string[] };
  return parsed.paragraphs ?? [];
}

export async function runJenniferMeetingSummary(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { sendGmailMessage } = await import("../../google/gmailClient");
  const { agentSenderEmail } = await import("../agentEmailAliases");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const recallKey = process.env.RECALLAI_API_KEY;
  const recallRegion = process.env.RECALLAI_REGION?.trim() || "us-east-1";
  if (!recallKey) {
    return { ok: false, detail: "RECALLAI_API_KEY is not set — cannot schedule or check meeting-recording bots." };
  }

  const cycles = await query<CycleRow>(
    `SELECT cycle_id, weekday, start_hour, start_minute, calendar_event_id, meet_link, cycle_start_date::text, cycle_end_date::text
       FROM mrv.jennifer_meeting_cycles
      WHERE meeting_key = $1 AND status IN ('active', 'renewal_requested')
      ORDER BY created_at DESC LIMIT 1`,
    [MEETING_KEY],
  );
  if (!cycles.length) return { ok: true, detail: "No active weekly-meeting cycle — nothing to summarize." };
  const cycle = cycles[0];

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const from = agentSenderEmail("jennifer");
  const results: string[] = [];

  /* ── job 1: schedule a bot for the next upcoming occurrence ────────── */
  const upcoming = firstOccurrenceOnOrAfter(todayStart, cycle.weekday);
  const withinCycle = ymd(upcoming) >= cycle.cycle_start_date && ymd(upcoming) <= cycle.cycle_end_date;
  const withinLookahead = upcoming.getTime() - todayStart.getTime() <= SCHEDULE_LOOKAHEAD_DAYS * 86_400_000;

  if (withinCycle && withinLookahead) {
    const existing = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.jennifer_meeting_summaries WHERE cycle_id = $1 AND meeting_date = $2`,
      [cycle.cycle_id, ymd(upcoming)],
    );
    if (Number(existing[0].n) === 0) {
      try {
        const meetLink = await getOrCreateMeetLink(ctx, cycle);
        // Recall wants an absolute instant. Rather than computing
        // Asia/Jerusalem's IST/IDT offset by hand, read back the exact
        // start Google already resolved for this specific occurrence —
        // authoritative, and correct across a DST boundary by construction.
        if (!ctx.googleAccessToken) throw new Error("no Google access token — cannot read the occurrence's start time");
        const { getEventInstanceStart } = await import("../../google/calendarClient");
        const joinAtIso = await getEventInstanceStart(ctx.googleAccessToken, cycle.calendar_event_id, ymd(upcoming));

        const { scheduleBotJoin } = await import("../../recall/recallClient");
        const { botId } = await scheduleBotJoin(recallKey, recallRegion, meetLink, joinAtIso);
        await query(
          `INSERT INTO mrv.jennifer_meeting_summaries (cycle_id, meeting_date, bot_id, status)
           VALUES ($1, $2, $3, 'scheduled')`,
          [cycle.cycle_id, ymd(upcoming), botId],
        );
        results.push(`Scheduled a recording bot for ${ymd(upcoming)} (bot ${botId}).`);
      } catch (e) {
        results.push(`Could not schedule a recording bot for ${ymd(upcoming)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /* ── job 2: collect any past occurrence still awaiting processing ──── */
  const pending = await query<SummaryRow>(
    `SELECT summary_id, cycle_id, meeting_date::text, bot_id, status
       FROM mrv.jennifer_meeting_summaries
      WHERE cycle_id = $1 AND status IN ('scheduled', 'recording') AND meeting_date <= $2::date
      ORDER BY meeting_date`,
    [cycle.cycle_id, ymd(todayStart)],
  );

  for (const row of pending) {
    if (!row.bot_id) continue;
    try {
      const { getBotStatus } = await import("../../recall/recallClient");
      const status = await getBotStatus(recallKey, recallRegion, row.bot_id);

      if (status.failed) {
        await query(`UPDATE mrv.jennifer_meeting_summaries SET status = 'failed', failure_reason = $2, updated_at = clock_timestamp() WHERE summary_id = $1`, [
          row.summary_id,
          `Recording bot failed (latest status: ${status.latestStatus ?? "unknown"}).`,
        ]);
        results.push(`Meeting ${row.meeting_date}: recording bot failed (${status.latestStatus ?? "unknown"}) — no summary this week.`);
        continue;
      }

      if (!status.audioReady) {
        if (row.status !== "recording") {
          await query(`UPDATE mrv.jennifer_meeting_summaries SET status = 'recording', updated_at = clock_timestamp() WHERE summary_id = $1`, [row.summary_id]);
        }
        results.push(`Meeting ${row.meeting_date}: still recording/processing, not ready yet.`);
        continue;
      }

      const audioRes = await fetch(status.audioDownloadUrl!);
      if (!audioRes.ok) throw new Error(`could not download the recording (${audioRes.status})`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
      if (audioBuffer.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error(
          `recording is ${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)}MB, over Groq's 25MB limit — no ffmpeg available here to re-encode it down`,
        );
      }

      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) throw new Error("GROQ_API_KEY is not set — cannot transcribe the recording");
      const { transcribeAudioBuffer } = await import("../../audio/groqTranscribe");
      const transcript = await transcribeAudioBuffer(groqKey, audioBuffer);
      if (!transcript.trim()) throw new Error("transcription came back empty");

      const paragraphs = await summarizeHebrew(transcript);
      if (!paragraphs.length) throw new Error("Hebrew summary came back empty");

      if (ctx.googleAccessToken) {
        await sendGmailMessage(ctx.googleAccessToken, {
          to: NOTIFY_TO,
          from,
          subject: `סיכום פגישה שבועית — ${row.meeting_date}`,
          bodyText: paragraphs.join("\n\n"),
        });
      }
      await query(
        `UPDATE mrv.jennifer_meeting_summaries SET status = 'sent', summary_text = $2, updated_at = clock_timestamp() WHERE summary_id = $1`,
        [row.summary_id, paragraphs.join("\n\n")],
      );
      results.push(`Meeting ${row.meeting_date}: summarized and emailed to ${NOTIFY_TO}.`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await query(`UPDATE mrv.jennifer_meeting_summaries SET status = 'failed', failure_reason = $2, updated_at = clock_timestamp() WHERE summary_id = $1`, [
        row.summary_id,
        reason,
      ]);
      results.push(`Meeting ${row.meeting_date}: failed — ${reason}`);
    }
  }

  if (!results.length) return { ok: true, detail: "Nothing due — no upcoming occurrence to schedule, nothing pending to collect." };

  return finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: "Weekly meeting summary — run report",
    bodyParagraphs: results,
    memoryKind: "jennifer_meeting_summary",
    agentId: "jennifer",
  });
}
