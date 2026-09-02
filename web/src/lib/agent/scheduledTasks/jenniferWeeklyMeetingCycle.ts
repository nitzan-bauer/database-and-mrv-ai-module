import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";
import { ymd, addDays, firstOccurrenceOnOrAfter, localDateTime } from "./dateHelpers";

export const TASK_KEY = "jennifer_weekly_meeting_cycle";

/**
 * Nitzan's own spec, verbatim, this session — and his explicit standing
 * requirement that every scheduled task reach FULL automation, not
 * best-effort: a recurring weekly work meeting that renews itself every
 * ~3 months on nothing more than a one-line human reply (an approval, or
 * a proposed new day/time), with no manual calendar work ever required.
 *
 * Lifecycle, one row per cycle in mrv.jennifer_meeting_cycles:
 *   (none) --create--> active --7 days before cycle end--> renewal_requested
 *   renewal_requested --a reply arrives--> renewed (+ new active row created)
 *   renewal_requested --cycle end passes, still no reply--> lapsed (terminal
 *     until a person emails again — auto-restarting a recurring commitment
 *     nobody confirmed would defeat the point of asking).
 *
 * This runs on the 'daily' cadence (0083_jennifer_meeting_cycles.sql) —
 * weekly/biweekly/monthly can't express "check every day for a reply, and
 * fire exactly 7 days before a moving cycle-end date."
 */

const MEETING_KEY = "weekly_work_meeting";
const ATTENDEE_EMAILS = ["elad@carbonature.io", "ebouton@gmail.com"];
const VALID_REPLIERS = new Set(["nitzan@carbonature.io", "elad@carbonature.io", "ebouton@gmail.com"]);
const NOTIFY_TO = "nitzan@carbonature.io, elad@carbonature.io";
const TIME_ZONE = "Asia/Jerusalem";
const DEFAULT_WEEKDAY = 1; // Monday — JS Date#getDay convention (0=Sunday..6=Saturday), matching mrv.scheduled_tasks.day_of_week
const DEFAULT_HOUR = 14;
const DEFAULT_MINUTE = 0;
const DURATION_MINUTES = 60;
const OCCURRENCES = 13; // ~3 months of weekly meetings
const RENEWAL_WINDOW_DAYS = 7;
const RENEWAL_SUBJECT_CORE = "Weekly meeting — approval needed for the next 3 months";

type CycleRow = {
  cycle_id: string;
  weekday: number;
  start_hour: number;
  start_minute: number;
  duration_minutes: number;
  cycle_end_date: string; // date, "YYYY-MM-DD"
  status: "active" | "renewal_requested" | "renewed" | "lapsed";
  renewal_requested_at: string | null;
  renewal_email_subject: string | null;
};

async function createCycle(
  ctx: ToolContext,
  startDate: Date,
  weekday: number,
  hour: number,
  minute: number,
): Promise<{ cycleId: string; cycleEndDate: string; eventId: string; meetLink: string | null }> {
  const { query } = await import("../../db");
  const { createCalendarEvent } = await import("../../google/calendarClient");

  const start = localDateTime(startDate, hour, minute);
  const endDate = new Date(startDate);
  const endMinuteTotal = hour * 60 + minute + DURATION_MINUTES;
  const end = localDateTime(endDate, Math.floor(endMinuteTotal / 60), endMinuteTotal % 60);
  const cycleEndDate = ymd(addDays(startDate, (OCCURRENCES - 1) * 7));

  if (!ctx.googleAccessToken) throw new Error("no Google access token — cannot create the calendar event");
  // requestMeetLink: jenniferMeetingSummary.ts's Recall.ai bot needs a real
  // join URL — without this the event would have none, same gap the
  // already-active cycle (created before this existed) has to self-heal
  // via addMeetLinkToEvent on first need.
  const { eventId, meetLink } = await createCalendarEvent(ctx.googleAccessToken, {
    summary: "CarboNature weekly work meeting",
    description: "Recurring weekly work meeting, auto-scheduled by Jennifer for the next ~3 months.",
    start,
    end,
    timeZone: TIME_ZONE,
    attendeeEmails: ATTENDEE_EMAILS,
    recurrence: [`RRULE:FREQ=WEEKLY;COUNT=${OCCURRENCES}`],
    requestMeetLink: true,
  });

  const rows = await query<{ cycle_id: string }>(
    `INSERT INTO mrv.jennifer_meeting_cycles
       (meeting_key, summary, attendee_emails, weekday, start_hour, start_minute, duration_minutes,
        calendar_event_id, meet_link, cycle_start_date, cycle_end_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
     RETURNING cycle_id`,
    [
      MEETING_KEY,
      "CarboNature weekly work meeting",
      ATTENDEE_EMAILS,
      weekday,
      hour,
      minute,
      DURATION_MINUTES,
      eventId,
      meetLink,
      ymd(startDate),
      cycleEndDate,
    ],
  );
  return { cycleId: rows[0].cycle_id, cycleEndDate, eventId, meetLink };
}

interface ReplyDecision {
  decision: "approve" | "new_time" | "unclear";
  weekday: number | null; // 0=Sun..6=Sat
  hour: number | null;
  minute: number | null;
}

const REPLY_PARSE_SYSTEM =
  "You read one email reply to a request asking whether a recurring weekly work meeting should continue for " +
  "another 3 months at its current day/time, or move to a different day/time. Return ONLY a JSON object, no " +
  'prose, no markdown fences: {"decision":"approve"|"new_time"|"unclear","weekday":number|null,"hour":number|null,' +
  '"minute":number|null}. "decision":"approve" for any clear yes/confirmation/thumbs-up with no new time named. ' +
  '"decision":"new_time" whenever the reply names a specific different day and/or time — set "weekday" as ' +
  '0=Sunday..6=Saturday and "hour"/"minute" in 24h time for whatever was named (keep the un-named field null only ' +
  'if truly not mentioned). "decision":"unclear" if the reply does not clearly do either (e.g. a question back, ' +
  "an out-of-office auto-reply, or unrelated content).";

async function parseReply(ctx: ToolContext, bodyText: string): Promise<ReplyDecision> {
  // Agent-learning plan (0078), same pattern as draftPddChapterContent.ts:
  // past lessons on this exact task, folded into the parsing prompt so
  // recorded outcomes actually influence the next run instead of sitting
  // unread in mrv.agent_memory.
  const { recallLessons } = await import("../lessonMemory");
  const pastLessons = await recallLessons(ctx, { actionName: TASK_KEY, projectId: TARGET_PROJECT_ID });
  const lessonsBlock = pastLessons.length
    ? "\n\nLessons from past runs (apply these — don't repeat a known mistake):\n" +
      pastLessons.map((l) => `- ${l.content}`).join("\n")
    : "";

  const { getConfiguredProvider } = await import("../provider");
  const provider = await getConfiguredProvider();
  const resp = await provider.complete({
    system: REPLY_PARSE_SYSTEM,
    userMessage: bodyText.slice(0, 4000) + lessonsBlock,
    tools: [],
  });
  const raw = resp.kind === "text" ? resp.text : "";
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ReplyDecision>;
    if (parsed.decision === "approve" || parsed.decision === "new_time" || parsed.decision === "unclear") {
      return {
        decision: parsed.decision,
        weekday: typeof parsed.weekday === "number" ? parsed.weekday : null,
        hour: typeof parsed.hour === "number" ? parsed.hour : null,
        minute: typeof parsed.minute === "number" ? parsed.minute : null,
      };
    }
  } catch {
    // fall through
  }
  return { decision: "unclear", weekday: null, hour: null, minute: null };
}

export async function runJenniferWeeklyMeetingCycle(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { sendGmailMessage } = await import("../../google/gmailClient");
  const { agentSenderEmail } = await import("../agentEmailAliases");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const from = agentSenderEmail("jennifer");
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const existing = await query<CycleRow>(
    `SELECT cycle_id, weekday, start_hour, start_minute, duration_minutes, cycle_end_date::text, status,
            renewal_requested_at, renewal_email_subject
       FROM mrv.jennifer_meeting_cycles
      WHERE meeting_key = $1
      ORDER BY created_at DESC LIMIT 1`,
    [MEETING_KEY],
  );

  /* ── no cycle has ever been created — set up the very first one ────── */
  if (!existing.length) {
    const startDate = firstOccurrenceOnOrAfter(addDays(todayStart, 1), DEFAULT_WEEKDAY);
    const { cycleEndDate, eventId } = await createCycle(ctx, startDate, DEFAULT_WEEKDAY, DEFAULT_HOUR, DEFAULT_MINUTE);

    if (ctx.googleAccessToken) {
      await sendGmailMessage(ctx.googleAccessToken, {
        to: NOTIFY_TO,
        from,
        subject: "Weekly work meeting scheduled",
        bodyText:
          `The recurring weekly work meeting is on the calendar: every Monday at 14:00 (Asia/Jerusalem), ` +
          `starting ${ymd(startDate)}, for the next ${OCCURRENCES} weeks (through ${cycleEndDate}).\n\n` +
          `A calendar invite has been sent to both of Elad's addresses. About a week before this block ends, ` +
          `I'll ask whether to continue for another ~3 months.`,
      });
    }
    return finishScheduledTask(ctx, {
      taskKey: TASK_KEY,
      projectId: TARGET_PROJECT_ID,
      subject: "Weekly work meeting — first cycle scheduled",
      bodyParagraphs: [
        `Created the first weekly-meeting cycle: Mondays 14:00 Asia/Jerusalem, ${ymd(startDate)} through ${cycleEndDate} (${OCCURRENCES} occurrences), calendar event ${eventId}.`,
        `Attendees: ${ATTENDEE_EMAILS.join(", ")}. Notification sent to ${NOTIFY_TO}.`,
      ],
      memoryKind: "jennifer_meeting_cycle",
      agentId: "jennifer",
    });
  }

  const cycle = existing[0];

  /* ── active cycle: check whether it's time to ask for renewal ──────── */
  if (cycle.status === "active") {
    const cycleEnd = new Date(`${cycle.cycle_end_date}T00:00:00Z`);
    const renewalDue = addDays(cycleEnd, -RENEWAL_WINDOW_DAYS);
    if (todayStart < renewalDue) {
      return { ok: true, detail: `Weekly meeting cycle active, not yet due for renewal (renews ${ymd(renewalDue)}).` };
    }

    const subject = `${RENEWAL_SUBJECT_CORE} (cycle ending ${cycle.cycle_end_date})`;
    if (!ctx.googleAccessToken) {
      return { ok: false, detail: "Weekly meeting renewal is due but there is no Google access token to send the request." };
    }
    await sendGmailMessage(ctx.googleAccessToken, {
      to: NOTIFY_TO,
      from,
      subject,
      bodyText:
        `The current weekly-meeting block ends ${cycle.cycle_end_date}. Reply to this email — from either of you — ` +
        `to schedule the next ~3 months:\n\n` +
        `- Reply "approve" (or similar) to keep it at the same day/time.\n` +
        `- Or name a different day and time if you'd rather move it — I'll use that instead, going forward.\n\n` +
        `Either one of you replying is enough for me to act on it.`,
    });
    await query(
      `UPDATE mrv.jennifer_meeting_cycles
          SET status = 'renewal_requested', renewal_requested_at = clock_timestamp(), renewal_email_subject = $2, updated_at = clock_timestamp()
        WHERE cycle_id = $1`,
      [cycle.cycle_id, subject],
    );
    return finishScheduledTask(ctx, {
      taskKey: TASK_KEY,
      projectId: TARGET_PROJECT_ID,
      subject: "Weekly work meeting — renewal requested",
      bodyParagraphs: [`Sent the renewal-approval request to ${NOTIFY_TO} (cycle ends ${cycle.cycle_end_date}).`],
      memoryKind: "jennifer_meeting_cycle",
      agentId: "jennifer",
    });
  }

  /* ── waiting on a reply ─────────────────────────────────────────────── */
  if (cycle.status === "renewal_requested") {
    if (!ctx.googleAccessToken) {
      return { ok: false, detail: "Weekly meeting renewal reply cannot be checked — no Google access token." };
    }
    const { searchGmailMessages, getMessagePlainTextBody } = await import("../../google/gmailClient");
    const afterDate = new Date(cycle.renewal_requested_at ?? cycle.cycle_end_date);
    const gmailAfter = `${afterDate.getUTCFullYear()}/${afterDate.getUTCMonth() + 1}/${afterDate.getUTCDate()}`;
    const candidates = await searchGmailMessages(
      ctx.googleAccessToken,
      `subject:"${RENEWAL_SUBJECT_CORE}" after:${gmailAfter}`,
      10,
    );
    const reply = candidates
      .filter((m) => VALID_REPLIERS.has(m.fromEmail))
      .filter((m) => !cycle.renewal_requested_at || (m.receivedAt && new Date(m.receivedAt) > new Date(cycle.renewal_requested_at)))
      .sort((a, b) => new Date(b.receivedAt ?? 0).getTime() - new Date(a.receivedAt ?? 0).getTime())[0];

    if (reply) {
      const body = await getMessagePlainTextBody(ctx.googleAccessToken, reply.gmailId);
      const parsed = await parseReply(ctx, body || reply.snippet || "");

      const nextWeekday = parsed.decision === "new_time" && parsed.weekday !== null ? parsed.weekday : cycle.weekday;
      const nextHour = parsed.decision === "new_time" && parsed.hour !== null ? parsed.hour : cycle.start_hour;
      const nextMinute = parsed.decision === "new_time" && parsed.minute !== null ? parsed.minute : cycle.start_minute;

      if (parsed.decision === "unclear") {
        // A real reply arrived but didn't clearly say either thing — surface it rather than guessing silently.
        return finishScheduledTask(ctx, {
          taskKey: TASK_KEY,
          projectId: TARGET_PROJECT_ID,
          subject: "Weekly work meeting — reply needs a human look",
          bodyParagraphs: [
            `A reply arrived from ${reply.fromEmail} but I couldn't tell whether it approves or proposes a new time: "${(body || reply.snippet || "").slice(0, 300)}"`,
            `Reply again more directly (e.g. "approve" or "move it to Wednesday 15:00") and I'll pick it up on the next run.`,
          ],
          memoryKind: "jennifer_meeting_cycle",
          agentId: "jennifer",
        });
      }

      const nextStart = firstOccurrenceOnOrAfter(addDays(new Date(`${cycle.cycle_end_date}T00:00:00Z`), 1), nextWeekday);
      const { cycleEndDate, eventId } = await createCycle(ctx, nextStart, nextWeekday, nextHour, nextMinute);
      await query(`UPDATE mrv.jennifer_meeting_cycles SET status = 'renewed', updated_at = clock_timestamp() WHERE cycle_id = $1`, [cycle.cycle_id]);

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const timeDesc = `${dayNames[nextWeekday]}s at ${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")} (Asia/Jerusalem)`;
      await sendGmailMessage(ctx.googleAccessToken, {
        to: NOTIFY_TO,
        from,
        subject: "Weekly work meeting renewed",
        bodyText:
          `Thanks — the weekly meeting is scheduled for another ${OCCURRENCES} weeks: ${timeDesc}, ${ymd(nextStart)} through ${cycleEndDate}.` +
          (parsed.decision === "new_time" ? ` (Moved per the requested new time.)` : ``),
      });

      return finishScheduledTask(ctx, {
        taskKey: TASK_KEY,
        projectId: TARGET_PROJECT_ID,
        subject: "Weekly work meeting — renewed",
        bodyParagraphs: [
          `Reply from ${reply.fromEmail} (${parsed.decision}) → new cycle created: ${timeDesc}, ${ymd(nextStart)} through ${cycleEndDate}, calendar event ${eventId}.`,
        ],
        memoryKind: "jennifer_meeting_cycle",
        agentId: "jennifer",
      });
    }

    // No reply yet.
    const cycleEnd = new Date(`${cycle.cycle_end_date}T00:00:00Z`);
    if (todayStart > cycleEnd) {
      await query(`UPDATE mrv.jennifer_meeting_cycles SET status = 'lapsed', updated_at = clock_timestamp() WHERE cycle_id = $1`, [cycle.cycle_id]);
      await sendGmailMessage(ctx.googleAccessToken, {
        to: NOTIFY_TO,
        from,
        subject: "Weekly work meeting — no reply, not renewed",
        bodyText:
          `The last weekly-meeting block ended ${cycle.cycle_end_date} and neither of you replied to the renewal request, ` +
          `so I haven't scheduled a new block. Reply to this email any time (or just tell me directly) and I'll set up the next ~3 months.`,
      });
      return finishScheduledTask(ctx, {
        taskKey: TASK_KEY,
        projectId: TARGET_PROJECT_ID,
        subject: "Weekly work meeting — lapsed",
        bodyParagraphs: [`Cycle ended ${cycle.cycle_end_date} with no renewal reply from either party. Marked lapsed; sent a final notice.`],
        memoryKind: "jennifer_meeting_cycle",
        agentId: "jennifer",
      });
    }
    return { ok: true, detail: `Weekly meeting renewal requested ${cycle.renewal_requested_at ?? "recently"}; still waiting on a reply.` };
  }

  /* ── lapsed — stays dormant until a person restarts it by hand ──────── */
  return { ok: true, detail: "Weekly meeting cycle previously lapsed with no renewal reply; awaiting manual restart." };
}
