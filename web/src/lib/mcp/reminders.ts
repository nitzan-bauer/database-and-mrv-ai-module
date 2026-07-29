import type { WorkOrder } from "@/lib/data/types";

/**
 * Dave's field reminders (spec §6.6). Deterministic in Tier 1 — the agent
 * phrases these itself from Tier 2, but the triggers live here so the human
 * contractor sees the same prompts whether or not an agent is attached.
 */

export interface Reminder {
  title: string;
  detail: string;
  tone: "info" | "urgent";
}

const DAY = 86_400_000;

export function fieldReminders(
  wo: WorkOrder,
  doneCount: number,
  now: Date = new Date(),
): Reminder[] {
  const out: Reminder[] = [];
  const total = wo.points.length;
  const remaining = total - doneCount;

  // same-season window closing
  if (wo.windowEnd) {
    const days = Math.ceil((Date.parse(wo.windowEnd) - now.getTime()) / DAY);
    if (days >= 0) {
      out.push({
        title: "Same-season window",
        detail:
          days === 0
            ? "closes today — VM0042 §8.2.1.1 requires the round inside one season"
            : `closes in ${days} day${days === 1 ? "" : "s"}`,
        tone: days <= 3 ? "urgent" : "info",
      });
    } else {
      out.push({
        title: "Same-season window closed",
        detail: `ended ${Math.abs(days)} days ago — flag before continuing`,
        tone: "urgent",
      });
    }
  }

  // remaining work
  if (remaining > 0) {
    out.push({
      title: `${remaining} point${remaining === 1 ? "" : "s"} left`,
      detail: `${doneCount} of ${total} submitted this round`,
      tone: remaining > total / 2 ? "info" : "info",
    });
  }

  // lab cutoff — samples ship within 5 days of collection
  if (wo.windowEnd) {
    const ship = new Date(Date.parse(wo.windowEnd) + 5 * DAY);
    out.push({
      title: "Lab cutoff",
      detail: `ship to ${wo.lab?.name ?? "the laboratory"} by ${ship.toISOString().slice(0, 10)} (≤5 days after collection)`,
      tone: "info",
    });
  }

  // token expiry
  if (wo.token) {
    const days = Math.ceil((Date.parse(wo.token.expiresAt) - now.getTime()) / DAY);
    if (days <= 5)
      out.push({
        title: "Access expiring",
        detail: `this link stops working in ${days} day${days === 1 ? "" : "s"}`,
        tone: "urgent",
      });
  }

  return out;
}
