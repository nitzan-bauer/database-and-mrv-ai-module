import "server-only";

/**
 * Real Google Calendar API v3 calls, over the same person's own OAuth
 * session as driveClient.ts (auth.ts's Calendar scope) — ported from the
 * carbonature-crm repo's googleCalendar.ts, where this exact code was
 * already live-tested against a real calendar (2026-08-08): a real busy
 * block was correctly excluded from the offered slots, and a real event
 * was created end to end.
 */

export interface Slot {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

const WORKDAY_START_HOUR = 9;
const WORKDAY_END_HOUR = 17;
const SLOT_MINUTES = 30;

/**
 * Free/busy query (developers.google.com/calendar/api/v3/reference/freebusy/query)
 * over the next `days` calendar days, then candidate slots are generated
 * in-process over working hours and filtered against the busy blocks —
 * Google's freebusy response gives busy ranges, not free ones.
 */
export async function listAvailableSlots(accessToken: string, days = 5, maxSlots = 10): Promise<Slot[]> {
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    }),
  });
  if (!res.ok) throw new Error(`Google freeBusy API returned ${res.status}`);

  const data = (await res.json()) as { calendars: { primary: { busy: { start: string; end: string }[] } } };
  const busy = data.calendars.primary.busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));

  const slots: Slot[] = [];
  for (let d = 0; d < days && slots.length < maxSlots; d++) {
    const day = new Date(timeMin);
    day.setDate(day.getDate() + d);
    day.setHours(WORKDAY_START_HOUR, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(WORKDAY_END_HOUR, 0, 0, 0);

    // Skip weekends — nobody at CarboNature is booking Saturday site visits by default.
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    for (let t = day.getTime(); t + SLOT_MINUTES * 60_000 <= dayEnd.getTime() && slots.length < maxSlots; t += SLOT_MINUTES * 60_000) {
      const slotStart = t;
      const slotEnd = t + SLOT_MINUTES * 60_000;
      const overlapsBusy = busy.some((b) => slotStart < b.end && slotEnd > b.start);
      if (!overlapsBusy && slotStart > Date.now()) {
        slots.push({ start: new Date(slotStart).toISOString(), end: new Date(slotEnd).toISOString() });
      }
    }
  }
  return slots;
}

/**
 * events.list with a text query and time window
 * (developers.google.com/calendar/api/v3/reference/events/list) — the
 * dedup check for the weekly webinar scan (0075): before creating a
 * reminder for an upcoming webinar, check whether one already exists in
 * that window, whether Rebeka put it there on an earlier run or Nitzan
 * added it by hand himself (real case: he manually added the 25 Aug
 * 2026 Verra webinar before Rebeka's own scan ever ran).
 */
export async function findEventsMatching(accessToken: string, query: string, timeMin: string, timeMax: string): Promise<boolean> {
  const params = new URLSearchParams({ q: query, timeMin, timeMax, maxResults: "5", singleEvents: "true" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Calendar events.list returned ${res.status}`);
  const data = (await res.json()) as { items?: unknown[] };
  return (data.items?.length ?? 0) > 0;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendeeEmail?: string;
  /** Additional attendees beyond attendeeEmail — merged into the same attendees list. Any address works, Workspace or not (e.g. a personal Gmail). */
  attendeeEmails?: string[];
  /**
   * IANA zone (e.g. "Asia/Jerusalem") to pair with a LOCAL (no offset/Z)
   * start/end dateTime. Required for a correctly-DST-aware recurring
   * event — a fixed UTC instant would drift by an hour off "14:00 local"
   * across an IDT/IST transition, which a bare RRULE cannot self-correct.
   */
  timeZone?: string;
  /** RRULE/EXDATE strings, e.g. ["RRULE:FREQ=WEEKLY;COUNT=13"], for events.insert's own `recurrence` field. Omit for a one-off event. */
  recurrence?: string[];
  /** Ask Calendar to generate a real Google Meet link for this event (needed for jenniferMeetingSummary.ts's bot to have somewhere to join). */
  requestMeetLink?: boolean;
}

export interface CreatedEvent {
  eventId: string;
  /** Only set when requestMeetLink was true. */
  meetLink: string | null;
}

/**
 * events.insert (developers.google.com/calendar/api/v3/reference/events/insert).
 *
 * `sendUpdates=all` is required whenever attendees are present — the API's
 * own default does NOT email invitees on a plain insert, so an event
 * created without it would silently never notify anyone it was invited.
 */
export async function createCalendarEvent(accessToken: string, input: CreateEventInput): Promise<CreatedEvent> {
  const attendeeEmails = [...(input.attendeeEmail ? [input.attendeeEmail] : []), ...(input.attendeeEmails ?? [])];
  const params = new URLSearchParams();
  if (attendeeEmails.length) params.set("sendUpdates", "all");
  if (input.requestMeetLink) params.set("conferenceDataVersion", "1");
  const qs = params.toString() ? `?${params.toString()}` : "";

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: input.timeZone ? { dateTime: input.start, timeZone: input.timeZone } : { dateTime: input.start },
      end: input.timeZone ? { dateTime: input.end, timeZone: input.timeZone } : { dateTime: input.end },
      attendees: attendeeEmails.length ? attendeeEmails.map((email) => ({ email })) : undefined,
      recurrence: input.recurrence,
      conferenceData: input.requestMeetLink
        ? { createRequest: { requestId: `jennifer-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } }
        : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar events.insert returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { id: string; hangoutLink?: string };
  return { eventId: data.id, meetLink: data.hangoutLink ?? null };
}

/**
 * events.get, just enough to read back an existing event's Meet link
 * (developers.google.com/calendar/api/v3/reference/events/get) — used to
 * retrofit a Meet link onto an event that was created before this
 * capability existed, without having to recreate the whole recurring series.
 */
export async function getCalendarEventMeetLink(accessToken: string, eventId: string): Promise<string | null> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Calendar events.get returned ${res.status}`);
  const data = (await res.json()) as { hangoutLink?: string };
  return data.hangoutLink ?? null;
}

/**
 * events.patch, adding a Google Meet link to an event that doesn't have
 * one yet (developers.google.com/calendar/api/v3/reference/events/patch) —
 * the retrofit path for jenniferMeetingSummary.ts's first run, since the
 * active weekly-meeting cycle was created (0083) before requestMeetLink
 * existed.
 */
export async function addMeetLinkToEvent(accessToken: string, eventId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?conferenceDataVersion=1`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        conferenceData: { createRequest: { requestId: `jennifer-retrofit-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      }),
    },
  );
  if (!res.ok) throw new Error(`Google Calendar events.patch (add Meet link) returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { hangoutLink?: string };
  if (!data.hangoutLink) throw new Error("events.patch succeeded but returned no hangoutLink");
  return data.hangoutLink;
}

/**
 * events.instances — the exact ISO 8601 start instant (already carrying
 * the correct UTC offset, DST included) for one specific occurrence of a
 * recurring event. Reading this back from Google rather than computing
 * an IANA-zone offset by hand (e.g. Asia/Jerusalem's IST/IDT switch) is
 * deliberate: Google has already resolved it correctly, and duplicating
 * that logic client-side is exactly the kind of thing that's easy to get
 * subtly wrong around a DST boundary.
 */
export async function getEventInstanceStart(accessToken: string, eventId: string, occurrenceDateYmd: string): Promise<string> {
  const timeMin = `${occurrenceDateYmd}T00:00:00Z`;
  const timeMax = `${occurrenceDateYmd}T23:59:59Z`;
  const params = new URLSearchParams({ timeMin, timeMax });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}/instances?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Google Calendar events.instances returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { items?: { start?: { dateTime?: string } }[] };
  const start = data.items?.[0]?.start?.dateTime;
  if (!start) throw new Error(`no occurrence of event ${eventId} found on ${occurrenceDateYmd}`);
  return start;
}
