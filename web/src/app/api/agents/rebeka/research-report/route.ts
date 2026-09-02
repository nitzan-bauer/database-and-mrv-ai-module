import { NextResponse } from "next/server";
import { TARGET_PROJECT_ID } from "@/lib/agent/scheduledTasks/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A generic delivery endpoint for Rebeka's one-off research reports —
 * asked for directly by Nitzan (e.g. "send Rebeka to research X"), not
 * produced by any recurring scheduled task. Reuses the exact
 * finishScheduledTask/audit pattern every one of her real scheduled tasks
 * already goes through, so an ad-hoc report gets the identical letterhead
 * PDF, memory write, and mrv.scheduled_task_reports row as a routine one —
 * not a lookalike, and distinguished from
 * rebeka_webinar_recording_summary's own task_key so the two don't mix in
 * her audit trail.
 */
interface RequestBody {
  subject: string;
  bodyParagraphs: string[];
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.EXTERNAL_AGENT_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.subject?.trim()) return NextResponse.json({ error: "subject is required" }, { status: 400 });
  if (!body.bodyParagraphs?.length) return NextResponse.json({ error: "bodyParagraphs is required" }, { status: 400 });

  const { query } = await import("@/lib/db");
  const { getServiceGoogleAccessToken } = await import("@/lib/google/serviceAuth");
  const { finishScheduledTask } = await import("@/lib/reports/scheduledTaskReport");

  const serviceEmail = process.env.CRON_GOOGLE_ACCOUNT_EMAIL?.trim() || "nitzan@carbonature.io";
  const googleAccessToken = (await getServiceGoogleAccessToken(query, serviceEmail)) ?? undefined;

  const outcome = await finishScheduledTask(
    { actor: "rebeka", actorKind: "agent", googleAccessToken },
    {
      taskKey: "rebeka_research_report",
      projectId: TARGET_PROJECT_ID,
      subject: body.subject,
      bodyParagraphs: body.bodyParagraphs,
      memoryKind: "rebeka_research_report",
      agentId: "rebeka",
    },
  );

  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}
