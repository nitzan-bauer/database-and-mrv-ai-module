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
  'events page and webinar-recordings page. Return ONLY a JSON object, no prose, no markdown fences: ' +
  '{"upcoming":[{"title":string,"date":string,"url":string}],"recordings":[{"title":string,"date":string,' +
  '"description":string}]}. "date" should be whatever date text the page itself gives (do not compute or ' +
  "guess a date). Only include entries that are clearly webinars or virtual training sessions, not in-person-" +
  "only conferences. If a list is empty, return an empty array for it — never invent an entry.";

interface ExtractedEvent {
  title: string;
  date: string;
  url?: string;
}
interface ExtractedRecording {
  title: string;
  date: string;
  description: string;
}

function parseExtraction(text: string): { upcoming: ExtractedEvent[]; recordings: ExtractedRecording[] } {
  try {
    const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { upcoming?: ExtractedEvent[]; recordings?: ExtractedRecording[] };
    return { upcoming: parsed.upcoming ?? [], recordings: parsed.recordings ?? [] };
  } catch {
    return { upcoming: [], recordings: [] };
  }
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
  const resp = await provider.complete({
    system: EXTRACTION_SYSTEM_PROMPT,
    userMessage:
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
      const parsedDate = new Date(ev.date);
      const hasRealDate = !Number.isNaN(parsedDate.getTime());
      if (!hasRealDate || !ctx.googleAccessToken) {
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
