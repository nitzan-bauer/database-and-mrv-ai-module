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
 * This task only owns SCHEDULING — an upcoming occurrence within the next
 * few days with no summary row yet gets a Recall bot scheduled via
 * join_at (Recall's own infrastructure handles exact-time joining, so
 * this can run any time before the meeting, not right at the start).
 *
 * COLLECTING a past occurrence (poll the bot, transcribe, summarize,
 * email, mark 'sent'/'failed') used to also live here, but moved to
 * .github/workflows/jennifer-meeting-summary-collect.yml — confirmed live
 * 2026-09-02 that a real ~36-minute meeting's download + re-encode +
 * transcribe + summarize + email chain exceeds even the Hobby plan's
 * maxDuration ceiling (60s, no higher tier without a paid upgrade) run
 * inside this Vercel function. GitHub Actions has no such limit, the same
 * reason rebeka_webinar_recording_summary already runs there.
 */

const MEETING_KEY = "weekly_work_meeting";
const SCHEDULE_LOOKAHEAD_DAYS = 7; // covers a full week's cadence — the daily cron always finds the upcoming Monday even if a run or two is missed

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

export async function runJenniferMeetingSummary(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const recallKey = process.env.RECALLAI_API_KEY;
  const recallRegion = process.env.RECALLAI_REGION?.trim() || "us-east-1";
  if (!recallKey) {
    return { ok: false, detail: "RECALLAI_API_KEY is not set — cannot schedule meeting-recording bots." };
  }

  const cycles = await query<CycleRow>(
    `SELECT cycle_id, weekday, start_hour, start_minute, calendar_event_id, meet_link, cycle_start_date::text, cycle_end_date::text
       FROM mrv.jennifer_meeting_cycles
      WHERE meeting_key = $1 AND status IN ('active', 'renewal_requested')
      ORDER BY created_at DESC LIMIT 1`,
    [MEETING_KEY],
  );
  if (!cycles.length) return { ok: true, detail: "No active weekly-meeting cycle — nothing to schedule." };
  const cycle = cycles[0];

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const results: string[] = [];

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

  if (!results.length) return { ok: true, detail: "Nothing due — no upcoming occurrence to schedule." };

  return finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: "Weekly meeting summary — run report",
    bodyParagraphs: results,
    memoryKind: "jennifer_meeting_summary",
    agentId: "jennifer",
  });
}
