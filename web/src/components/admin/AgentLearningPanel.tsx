import type { AgentWeekStats } from "@/lib/agent/learningStats";

const AGENT_COLORS: Record<string, string> = {
  john: "#1A3A3A",
  rebeka: "#5B8C6E",
  dave: "#4A7FB5",
  ron: "#C9A227",
  jennifer: "#B5734A",
};

/**
 * The literal per-agent learning curve (agent-learning plan, 0078's own
 * comment has the full context): action success rate and human
 * approval rate, per agent, per week — real numbers from
 * mrv.audit_log and mrv.agent_feedback, not a synthetic "quality
 * score." Early on this is mostly sparse/flat, and the panel says so
 * rather than implying a trend that isn't there yet.
 */
export function AgentLearningPanel({ stats }: { stats: AgentWeekStats[] }) {
  const agentIds = [...new Set(stats.map((s) => s.agentId))].sort();

  if (!agentIds.length) {
    return (
      <section id="agent-learning" className="scroll-mt-6">
        <h2 className="text-base font-bold text-pine-700">Agent learning curve</h2>
        <p className="mt-3 rounded-xl border border-line bg-cream px-4 py-3 text-[13px] text-muted">
          No agent actions or feedback recorded yet — the curve fills in as agents run and their work gets
          approved, corrected, or rejected.
        </p>
      </section>
    );
  }

  return (
    <section id="agent-learning" className="scroll-mt-6">
      <h2 className="text-base font-bold text-pine-700">Agent learning curve</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-muted">
        No model here is retrained — Claude&apos;s weights don&apos;t change per action. What these charts show
        is real: how often an agent&apos;s action gets refused by policy, and how often a person approves,
        corrects, or rejects what it produced, week over week. Improvement means those lines actually moving,
        not an impression.
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {agentIds.map((agentId) => (
          <AgentCard key={agentId} agentId={agentId} rows={stats.filter((s) => s.agentId === agentId)} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agentId, rows }: { agentId: string; rows: AgentWeekStats[] }) {
  const color = AGENT_COLORS[agentId] ?? "#5B8C6E";
  const totalActions = rows.reduce((n, r) => n + r.actionCount, 0);
  const totalFeedback = rows.reduce((n, r) => n + r.approvedCount + r.correctedCount + r.rejectedCount, 0);

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold capitalize text-pine-700">{agentId}</p>
        <span className="font-mono text-[10.5px] text-faint">
          {totalActions} action{totalActions === 1 ? "" : "s"} · {totalFeedback} verdict{totalFeedback === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length < 2 ? (
        <p className="mt-3 text-[12px] text-faint">Not enough weeks of history yet for a real trend.</p>
      ) : (
        <>
          <SuccessLine rows={rows} color={color} />
          <ApprovalLine rows={rows} color={color} />
        </>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-faint">
              <th className="pb-1 pr-2 font-medium">Week of</th>
              <th className="pb-1 pr-2 font-medium">Actions</th>
              <th className="pb-1 pr-2 font-medium">Refused</th>
              <th className="pb-1 pr-2 font-medium">Approved</th>
              <th className="pb-1 pr-2 font-medium">Corrected</th>
              <th className="pb-1 font-medium">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.weekStart} className="border-t border-line/60">
                <td className="py-1 pr-2 font-mono text-muted">{r.weekStart}</td>
                <td className="py-1 pr-2">{r.actionCount}</td>
                <td className="py-1 pr-2">{r.refusedCount}</td>
                <td className="py-1 pr-2 text-verify-700">{r.approvedCount}</td>
                <td className="py-1 pr-2 text-gold-600">{r.correctedCount}</td>
                <td className="py-1 text-earth-600">{r.rejectedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A tiny SVG line: one point per week, action success rate (1 - refused/total). */
function SuccessLine({ rows, color }: { rows: AgentWeekStats[]; color: string }) {
  const points = rows.map((r) => (r.actionCount ? 1 - r.refusedCount / r.actionCount : null));
  return <Sparkline label="Action success rate" values={points} color={color} />;
}

/** A tiny SVG line: one point per week, approval rate (approved / all verdicts given). */
function ApprovalLine({ rows, color }: { rows: AgentWeekStats[]; color: string }) {
  const points = rows.map((r) => {
    const total = r.approvedCount + r.correctedCount + r.rejectedCount;
    return total ? r.approvedCount / total : null;
  });
  return <Sparkline label="Human approval rate" values={points} color={color} />;
}

function Sparkline({ label, values, color }: { label: string; values: Array<number | null>; color: string }) {
  const w = 240;
  const h = 40;
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) {
    return (
      <p className="mt-2 text-[11px] text-faint">
        {label}: no data yet.
      </p>
    );
  }
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const path = values
    .map((v, i) => (v === null ? null : `${i === 0 ? "M" : "L"}${i * step},${h - v * h}`))
    .filter(Boolean)
    .join(" ");
  const last = known[known.length - 1];

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="font-mono font-semibold" style={{ color }}>
          {Math.round(last * 100)}%
        </span>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-1">
        <line x1={0} y1={h} x2={w} y2={h} stroke="#EFEAE0" strokeWidth={1} />
        <path d={path ?? ""} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
