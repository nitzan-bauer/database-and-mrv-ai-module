import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import { createCalendarEvent } from "../google/calendarClient";

export interface ScheduleCalendarEventInput {
  summary: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  description?: string;
  attendeeEmail?: string;
}

/**
 * Creates a real event on the signed-in person's own primary calendar —
 * 'confirm', not 'auto': same standing as centralizeFarmDocument, since a
 * calendar event is real and externally visible (an invite can reach an
 * attendee) the moment it is created, not something to slip in unattended.
 */
export async function scheduleCalendarEvent(
  ctx: ToolContext,
  input: ScheduleCalendarEventInput,
): Promise<ToolResult<{ eventId: string }>> {
  const policy = await checkPolicy("schedule_calendar_event", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("scheduleCalendarEvent: no Google Calendar access token for this session — sign out and back in to grant it.");
  }
  if (!input.summary.trim()) return fail("scheduleCalendarEvent: summary is required.");
  if (!input.start || !input.end) return fail("scheduleCalendarEvent: start and end are required.");

  let eventId: string;
  try {
    eventId = await createCalendarEvent(ctx.googleAccessToken, {
      summary: input.summary,
      description: input.description,
      start: input.start,
      end: input.end,
      attendeeEmail: input.attendeeEmail,
    });
  } catch (e) {
    return fail(`scheduleCalendarEvent: ${e instanceof Error ? e.message : String(e)}`);
  }

  await audit(ctx, "schedule_calendar_event", { type: "calendar_event", id: eventId }, {
    summary: input.summary,
    start: input.start,
    end: input.end,
    attendeeEmail: input.attendeeEmail,
  });

  return ok({ eventId });
}
