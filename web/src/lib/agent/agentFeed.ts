import "server-only";

export interface AgentFeedItem {
  kind: "report" | "lesson";
  title: string;
  body: string;
  createdAt: string;
  /** report only — whether it went out as an email. */
  emailed?: boolean;
}

/**
 * Section 2's "feed" (Nitzan's own spec — a scroll of activity blocks
 * specific to one agent's role), built from what that agent has actually
 * produced: its scheduled-task reports (mrv.scheduled_task_reports, keyed
 * by task_key's own "<agentId>_..." convention) and the lessons the
 * agent-learning system has distilled for it (mrv.agent_memory, kind
 * 'lesson', metadata.agentId — see lessonMemory.ts). Both are real rows an
 * agent actually wrote; nothing here is synthesized for the page itself.
 */
export async function listAgentFeed(agentId: string, limit = 20): Promise<AgentFeedItem[]> {
  const { query } = await import("../db");

  const [reports, lessons] = await Promise.all([
    query<{ subject: string; body_text: string; emailed: boolean; created_at: string }>(
      `SELECT subject, body_text, emailed, created_at::text
         FROM mrv.scheduled_task_reports
        WHERE task_key LIKE $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [`${agentId}\\_%`, limit],
    ),
    query<{ content: string; created_at: string }>(
      `SELECT content, created_at::text
         FROM mrv.agent_memory
        WHERE kind = 'lesson' AND metadata->>'agentId' = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [agentId, limit],
    ),
  ]);

  const items: AgentFeedItem[] = [
    ...reports.map((r) => ({
      kind: "report" as const,
      title: r.subject,
      body: r.body_text,
      createdAt: r.created_at,
      emailed: r.emailed,
    })),
    ...lessons.map((l) => ({
      kind: "lesson" as const,
      title: "Lesson learned",
      body: l.content,
      createdAt: l.created_at,
    })),
  ];

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}
