import { creditPipeline, listAgents, listAuditLog } from "@/lib/data";
import { DATA_MODE } from "@/lib/env";
import { AgentOrgChart } from "@/components/agents/AgentOrgChart";

export const dynamic = "force-dynamic";

/**
 * Screen A — the Verified Credits Factory control tower (spec §13).
 *
 * John's dashboard. Three things on it, and all three are counted from the
 * database rather than tracked in a status field: the department, the credit
 * pipeline, and what the agents have actually done.
 *
 * That choice is the point. A pipeline stage here is a COUNT over the rows
 * that stage produces, so it cannot drift the way a separately-maintained
 * status can — there is no second record to forget to update. Where a stage
 * reads zero, the reason is printed beside it, because a zero on a control
 * tower is only useful with its cause attached.
 */
export default async function AgentsPage() {
  if (DATA_MODE !== "db") {
    return (
      <Frame>
        <div className="rounded-xl border border-line bg-white p-6">
          <p className="text-sm font-semibold text-pine-700">
            The department runs on the database.
          </p>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Agents, their prompts and their recorded actions all live in the <span className="font-mono text-[12px]">mrv</span> schema.
            There is no fixture stand-in: a dashboard reporting invented agent activity would be
            worse than no dashboard.
          </p>
        </div>
      </Frame>
    );
  }

  const [agents, pipeline, audit] = await Promise.all([
    listAgents(),
    creditPipeline(),
    listAuditLog(200),
  ]);

  const actorIds = new Set(agents.map((a) => a.actorId));
  const agentActions = audit.filter((e) => actorIds.has(e.actor)).slice(0, 12);
  const byActor = new Map(agents.map((a) => [a.actorId, a]));

  // Connections are reported as they actually are. The database is reachable
  // — this page just read it — and nothing else has been wired yet.
  const dbConn = {
    name: "Project database (mrv on RDS)",
    status: "connected" as const,
    detail: "read and write",
  };
  const connections: Record<string, Array<{ name: string; status: "connected" | "not configured"; detail: string }>> =
    Object.fromEntries(
      agents.map((a) => [
        a.agentId,
        [
          a.tools.length ? dbConn : { ...dbConn, detail: "read only — no tools held" },
          { name: "Verra registry account", status: "not configured" as const, detail: "no credentials" },
          { name: "Mailboxes", status: "not configured" as const, detail: "no mail integration" },
          {
            name: "Model runtime",
            status: "not configured" as const,
            detail: "no model API key",
          },
        ],
      ]),
    );

  const totalBuilt = agents.reduce((n, a) => n + a.skills.length + a.tools.length, 0);
  const totalPlanned = agents.reduce((n, a) => n + a.plannedSkills.length, 0);

  return (
    <Frame>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Agents" value={String(agents.length)} foot="one head, four reports" />
        <Stat label="Built" value={String(totalBuilt)} foot="skills and tools that run" />
        <Stat label="Planned" value={String(totalPlanned)} foot="named in the specification" />
        <Stat
          label="Actions recorded"
          value={String(agents.reduce((n, a) => n + a.actionCount, 0))}
          foot="by an agent, in the audit log"
        />
      </div>

      <section>
        <h2 className="mb-3 text-base font-bold text-pine-700">The department</h2>
        <AgentOrgChart agents={agents} connections={connections} />
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-pine-700">Credit pipeline</h2>
        <p className="mb-3 max-w-3xl text-[13px] text-muted">
          Each figure is a count of the rows that stage produces, so it cannot disagree with the
          database. Where a stage is at zero, what it is waiting on is stated.
        </p>
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          {pipeline.map((s, i) => (
            <div
              key={s.key}
              className={
                "flex items-baseline gap-3 px-4 py-2.5 " + (i > 0 ? "border-t border-line" : "")
              }
            >
              <span className="w-40 shrink-0 text-[13px] font-semibold text-pine-700">{s.label}</span>
              <span
                className={
                  "w-16 shrink-0 text-right font-mono text-[15px] font-bold " +
                  (s.count > 0 ? "text-pine-700" : "text-faint")
                }
              >
                {s.count}
              </span>
              <span className="w-24 shrink-0 font-mono text-[10.5px] text-faint">{s.unit}</span>
              {s.blocker && (
                <span className="text-[11.5px] text-earth-600">waiting on {s.blocker}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-pine-700">Recent agent activity</h2>
        <p className="mb-3 max-w-3xl text-[13px] text-muted">
          Only entries whose actor is an agent. Everything else in the audit log was done by a
          person or by a database trigger, and mixing the two would defeat the point of recording
          an actor.
        </p>
        {agentActions.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-5">
            <p className="text-[13px] font-semibold text-pine-700">No agent has acted yet.</p>
            <p className="mt-1 max-w-2xl text-[12.5px] text-muted">
              Every write so far was made by a person. Agents act once the runtime is wired, which
              needs a model API key — the entry that appears here first will be an agent calling one
              of the tools it holds, recorded under its own identity.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            {agentActions.map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                className={"flex items-baseline gap-3 px-4 py-2 text-[12.5px] " + (i > 0 ? "border-t border-line" : "")}
              >
                <span className="w-36 shrink-0 font-mono text-[10.5px] text-faint">
                  {new Date(e.ts).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <span className="w-24 shrink-0 font-semibold text-pine-700">
                  {byActor.get(e.actor)?.displayName ?? e.actor}
                </span>
                <span className="font-mono text-[11px] text-pine-600">{e.action}</span>
                <span className="truncate font-mono text-[10.5px] text-faint">
                  {e.targetType} {e.targetId}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Verified Credits Factory</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The AI-agent department and the credit pipeline it exists to move. One mission: the
          maximum volume of Verra-verified credits, in the shortest time — every agent, skill and
          screen measured against that outcome.
        </p>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3.5">
      <div className="text-[19px] font-bold leading-tight text-pine-700">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-[10.5px] text-faint">{foot}</div>
    </div>
  );
}
