import "server-only";

/** Small date helpers shared by Jennifer's meeting-cycle and meeting-summary tasks — both work in whole UTC-midnight days and civil (non-UTC) local times. */

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** The first date on or after `from` (a UTC-midnight Date) that falls on `weekday` (0=Sun..6=Sat, JS Date#getDay convention). */
export function firstOccurrenceOnOrAfter(from: Date, weekday: number): Date {
  const diff = (weekday - from.getUTCDay() + 7) % 7;
  return addDays(from, diff);
}

/** "YYYY-MM-DDTHH:MM:SS", paired with a timeZone field — Calendar/Recall's own format for a civil-time instant that stays aligned across DST. */
export function localDateTime(date: Date, hour: number, minute: number): string {
  return `${ymd(date)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}
