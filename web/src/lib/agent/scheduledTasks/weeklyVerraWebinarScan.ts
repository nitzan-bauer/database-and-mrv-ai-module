import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "rebeka_weekly_verra_webinar_scan";

const EVENTS_URL = "https://verra.org/events/";
const RECORDINGS_URL = "https://verra.org/webinar-recordings/";
const MAX_CALENDAR_EVENTS = 3;

const EXTRACTION_SYSTEM_PROMPT =
  "You extract structured event data from raw webpage text. You will be given the text of Verra's public " +
  'events page and webinar-recordings page, and today\'s date. Return ONLY a JSON object, no prose, no ' +
  'markdown fences: {"upcoming":[{"title":string,"date":string,"isoDate":string|null,"url":string}],' +
  '"recordings":[{"title":string,"date":string,"description":string}]}. "date" should be whatever date text ' +
  'the page itself gives verbatim, e.g. "August 25 @ 10:00 am - 11:30 am EDT" (do not compute or guess — ' +
  'this field is for display only). "isoDate" is your own best-effort normalization of that same date to ' +
  'strict "YYYY-MM-DD" (date only, ignore the time-of-day and timezone). Verra\'s events page never states ' +
  "the year, so infer it using today's date as the reference point: an upcoming-events listing describes " +
  "future sessions, so if the month/day given has already passed this year, it means next year, not this " +
  'year. If you cannot confidently determine a specific calendar date, set isoDate to null — never guess. ' +
  "Only include entries that are clearly webinars or virtual training sessions, not in-person-only " +
  "conferences. If a list is empty, return an empty array for it — never invent an entry.";

interface ExtractedEvent {
  title: string;
  date: string;
  isoDate?: string | null;
  url?: string;
}
interface ExtractedRecording {
  title: string;
  date: string;
  description: string;
}

function parseExtraction(text: string): { upcoming: ExtractedEvent[]; recordings: ExtractedRecording[] } {
  try {
    // .trim() BEFORE stripping fences — see monthlyCreditMarketScan.ts's
    // parseDeals for why the anchored strip regexes need pre-trimmed input.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { upcoming?: ExtractedEvent[]; recordings?: ExtractedRecording[] };
    return { upcoming: parsed.upcoming ?? [], recordings: parsed.recordings ?? [] };
  } catch {
    return { upcoming: [], recordings: [] };
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The model's own normalized isoDate, never the raw display text — native `Date` parsing of Verra's own
 * format ("August 25 @ 10:00 am - 11:30 am EDT") either fails outright or, worse, silently succeeds with
 * the wrong year (JS defaults a yearless date string to 2001). */
function resolveEventDate(ev: ExtractedEvent): Date | null {
  if (!ev.isoDate || !ISO_DATE_RE.test(ev.isoDate)) return null;
  const d = new Date(`${ev.isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Weekly Verra webinar scan (Nitzan's own spec, confirmed live this
 * session with him what "attend in my place" can honestly mean for an
 * unattended cron job): Rebeka cannot join a live video call, and no
 * transcript exists for a past recording — only Verra's own short
 * written description per webinar. So this scans verra.org/events/ for
 * upcoming sessions (puts a real calendar reminder on Nitzan's calendar,
 * deduped against what's already there — he added the 25 Aug 2026
 * session by hand before this ever ran) and verra.org/webinar-recordings/
 * for new past sessions (reports on Verra's own published description,
 * explicitly labeled as such, never as if Rebeka watched the video).
 */
export async function runWeeklyVerraWebinarScan(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { query } = await import("../../db");
  const { fetchPublicUrl } = await import("../../tools/fetchPublicUrl");
  const { getConfiguredProvider } = await import("../../agent/provider");
  const { findEventsMatching, createCalendarEvent } = await import("../../google/calendarClient");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const [eventsPage, recordingsPage] = await Promise.all([
    fetchPublicUrl(ctx, { url: EVENTS_URL }),
    fetchPublicUrl(ctx, { url: RECORDINGS_URL }),
  ]);

  if (!eventsPage.ok && !recordingsPage.ok) {
    return { ok: false, detail: `weekly Verra webinar scan: could not reach either page — ${eventsPage.error}` };
  }

  const provider = await getConfiguredProvider();
  const todayIso = new Date().toISOString().slice(0, 10);
  const resp = await provider.complete({
    system: EXTRACTION_SYSTEM_PROMPT,
    userMessage:
      `Today's date: ${todayIso}\n\n` +
      `Events page (${EVENTS_URL}):\n${eventsPage.ok ? eventsPage.data.textExcerpt : "(fetch failed)"}\n\n` +
      `Recordings page (${RECORDINGS_URL}):\n${recordingsPage.ok ? recordingsPage.data.textExcerpt : "(fetch failed)"}`,
    tools: [],
  });
  const extracted = parseExtraction(resp.kind === "text" ? resp.text : "");

  const paragraphs: string[] = [];

  /* ── upcoming sessions → calendar reminders, deduped ──────── */
  if (extracted.upcoming.length) {
    paragraphs.push(`Upcoming webinar/virtual session(s) found on Verra's events page:`);
    let created = 0;
    for (const ev of extracted.upcoming.slice(0, MAX_CALENDAR_EVENTS)) {
      const parsedDate = resolveEventDate(ev);
      if (!parsedDate || !ctx.googleAccessToken) {
        paragraphs.push(`- "${ev.title}" (${ev.date}) — could not parse a date to add a calendar reminder for this one.`);
        continue;
      }
      const dayStart = new Date(parsedDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      try {
        const alreadyOnCalendar = await findEventsMatching(
          ctx.googleAccessToken,
          ev.title,
          dayStart.toISOString(),
          dayEnd.toISOString(),
        );
        if (alreadyOnCalendar) {
          paragraphs.push(`- "${ev.title}" (${ev.date}) — already on your calendar, no duplicate created.`);
          continue;
        }
        await createCalendarEvent(ctx.googleAccessToken, {
          summary: `Verra webinar: ${ev.title}`,
          description: `Auto-detected by Rebeka's weekly Verra scan.${ev.url ? ` Details: ${ev.url}` : ""}`,
          start: dayStart.toISOString(),
          end: new Date(dayStart.getTime() + 60 * 60 * 1000).toISOString(),
        });
        created++;
        paragraphs.push(`- "${ev.title}" (${ev.date}) — added a calendar reminder.`);
      } catch (e) {
        paragraphs.push(`- "${ev.title}" (${ev.date}) — could not check/create the calendar reminder: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!created) paragraphs.push("(No new calendar reminders were needed this week.)");
  } else {
    paragraphs.push("No upcoming webinars found on Verra's events page this week.");
  }

  /* ── recent recordings → report on Verra's own description ─── */
  if (extracted.recordings.length) {
    const priorReports = await query<{ body_text: string }>(
      `SELECT body_text FROM mrv.scheduled_task_reports WHERE task_key = $1 ORDER BY created_at DESC LIMIT 12`,
      [TASK_KEY],
    );
    const priorText = priorReports.map((r) => r.body_text).join("\n");

    const newRecordings = extracted.recordings.filter((r) => !priorText.includes(r.title));
    if (newRecordings.length) {
      paragraphs.push(
        `New webinar recording(s) published since the last scan (summarized from Verra's own published ` +
          `description — this is not a transcript of the video, Rebeka cannot watch or listen to it):`,
      );
      for (const rec of newRecordings) {
        paragraphs.push(`- "${rec.title}" (${rec.date}): ${rec.description}`);
      }
    } else {
      paragraphs.push("No new webinar recordings published since the last scan.");
    }
  } else {
    paragraphs.push("No recordings found on Verra's webinar-recordings page this week.");
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Verra webinar scan — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "verra_webinar_scan",
  });

  return { ok: outcome.ok, detail: outcome.detail };
}
