import "server-only";

export interface AgentWeekStats {
  agentId: string;
  weekStart: string; // ISO date, Monday
  actionCount: number;
  refusedCount: number;
  approvedCount: number;
  correctedCount: number;
  rejectedCount: number;
}

/**
 * The literal "learning curve" data (agent-learning plan, 0078's own
 * comment has the full context) — per agent, per week: how many
 * actions ran, how many were refused by policy (audit_log, made
 * agent-attributable by the cron route's own actor fix — it used to
 * log every scheduled task under the generic 'cron' identity), and how
 * many drafts a human approved/corrected/rejected (agent_feedback).
 * Two real signals, not a single made-up "quality score" — the Admin
 * view renders both as their own trend lines per agent.
 */
export async function listAgentLearningStats(
  query: <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>,
  weeks = 8,
): Promise<AgentWeekStats[]> {
  // week_start cast to ::text explicitly — node-postgres returns a bare
  // `date` column as a native JS Date object, not a string, despite the
  // query<> annotation claiming otherwise (the same real gotcha already
  // hit once this session with a timestamptz column — confirmed live
  // here too: rendering the un-cast Date directly in the Admin page
  // crashed with "Objects are not valid as a React child").
  const actionRows = await query<{ agent_id: string; week_start: string; action_count: string; refused_count: string }>(
    `SELECT actor AS agent_id,
            (date_trunc('week', ts)::date)::text AS week_start,
            count(*)::text AS action_count,
            count(*) FILTER (WHERE payload->>'outcome' = 'refused')::text AS refused_count
       FROM mrv.audit_log
      WHERE actor IN (SELECT agent_id FROM mrv.agents)
        AND ts > now() - ($1 || ' weeks')::interval
      GROUP BY actor, date_trunc('week', ts)
      ORDER BY 2`,
    [String(weeks)],
  );

  const feedbackRows = await query<{ agent_id: string; week_start: string; verdict: string; n: string }>(
    `SELECT agent_id,
            (date_trunc('week', created_at)::date)::text AS week_start,
            verdict,
            count(*)::text AS n
       FROM mrv.agent_feedback
      WHERE created_at > now() - ($1 || ' weeks')::interval
      GROUP BY agent_id, date_trunc('week', created_at), verdict`,
    [String(weeks)],
  );

  const byKey = new Map<string, AgentWeekStats>();
  const keyOf = (agentId: string, weekStart: string) => `${agentId}::${weekStart}`;
  const cell = (agentId: string, weekStart: string): AgentWeekStats => {
    const key = keyOf(agentId, weekStart);
    let row = byKey.get(key);
    if (!row) {
      row = { agentId, weekStart, actionCount: 0, refusedCount: 0, approvedCount: 0, correctedCount: 0, rejectedCount: 0 };
      byKey.set(key, row);
    }
    return row;
  };

  for (const r of actionRows) {
    const row = cell(r.agent_id, r.week_start);
    row.actionCount = Number(r.action_count);
    row.refusedCount = Number(r.refused_count);
  }
  for (const r of feedbackRows) {
    const row = cell(r.agent_id, r.week_start);
    if (r.verdict === "approved") row.approvedCount = Number(r.n);
    if (r.verdict === "corrected") row.correctedCount = Number(r.n);
    if (r.verdict === "rejected") row.rejectedCount = Number(r.n);
  }

  return [...byKey.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || a.weekStart.localeCompare(b.weekStart));
}
