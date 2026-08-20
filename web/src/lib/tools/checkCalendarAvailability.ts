import "server-only";
import { checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import { listAvailableSlots, type Slot } from "../google/calendarClient";

/**
 * Read-only free/busy lookup on the signed-in person's own primary
 * calendar — Jennifer's scheduling skill (meetings, farmer site visits, VVB
 * calls). Never a substitute for actually booking one: see
 * scheduleCalendarEvent for that.
 */
export async function checkCalendarAvailability(
  ctx: ToolContext,
  input: { days?: number; maxSlots?: number },
): Promise<ToolResult<Slot[]>> {
  const policy = await checkPolicy("check_calendar_availability", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("checkCalendarAvailability: no Google Calendar access token for this session — sign out and back in to grant it.");
  }

  const days = input.days ?? 5;
  const maxSlots = input.maxSlots ?? 10;
  if (!(days > 0) || !(maxSlots > 0)) return fail("checkCalendarAvailability: days and maxSlots must be positive.");

  let slots: Slot[];
  try {
    slots = await listAvailableSlots(ctx.googleAccessToken, days, maxSlots);
  } catch (e) {
    return fail(`checkCalendarAvailability: ${e instanceof Error ? e.message : String(e)}`);
  }

  return ok(slots);
}
