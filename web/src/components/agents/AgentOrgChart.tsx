"use client";

import { useState } from "react";
import type { AgentRecord } from "@/lib/data";

/** External systems each agent is defined to reach, and whether it is wired. */
interface Connection {
  name: string;
  status: "connected" | "not configured";
  detail: string;
}

/**
 * Screen A — the agent hierarchy (spec §13).
 *
 * The specification's mockup carries aspirational badges: John 12 skills / 9
 * tools, Dave 9 / 8. This shows what exists. A control tower reporting nine
 * skills where one is built fails in the same way an emissions figure over
 * invented inputs does — it reads as a fact and is not one — and the entire
 * purpose of the screen is that the department head can see where things
 * actually stand. Planned skills are shown too, in their own column, so the
 * gap stays visible rather than being averaged into a single number.
 *
 * Status is derived from the audit log rather than stored. An agent that has
 * never written anything reads "idle" because it has never acted; there is
 * no status field to set optimistically.
 */
export function AgentOrgChart({
  agents,
  connections,
}: {
  agents: AgentRecord[];
  connections: Record<string, Connection[]>;
}) {
  const [open, setOpen] = useState<AgentRecord | null>(null);

  const head = agents.find((a) => a.reportsTo === null);
  const reports = agents.filter((a) => a.reportsTo !== null);

  return (
    <div>
      {head && (
        <>
          <div className="flex justify-center">
            <AgentBlock agent={head} wide onOpen={() => setOpen(head)} />
          </div>
          <div className="mx-auto my-3 h-5 w-px bg-line" />
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {reports.map((a) => (
          <AgentBlock key={a.agentId} agent={a} onOpen={() => setOpen(a)} />
        ))}
      </div>

      <p className="mt-4 font-mono text-[10.5px] text-faint">
        <Dot on /> has acted &nbsp;·&nbsp; <Dot /> idle &nbsp;·&nbsp; counts are what exists today,
        not the specification target &nbsp;·&nbsp; click an agent for its prompt, tools and skills
      </p>

      {open && <AgentModal agent={open} connections={connections[open.agentId] ?? []} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Dot({ on = false }: { on?: boolean }) {
  return (
    <span
      className={"inline-block h-2 w-2 rounded-full align-middle " + (on ? "bg-sage-500" : "bg-line")}
    />
  );
}

function Avatar({ agent, size = 40 }: { agent: AgentRecord; size?: number }) {
  const initials = agent.displayName.slice(0, 1);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(140deg, hsl(${agent.avatarHue} 42% 46%), hsl(${agent.avatarHue} 38% 32%))`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function AgentBlock({
  agent,
  wide = false,
  onOpen,
}: {
  agent: AgentRecord;
  wide?: boolean;
  onOpen: () => void;
}) {
  const acted = agent.actionCount > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        "rounded-xl border border-line bg-white p-4 text-left transition-colors hover:border-pine-300 hover:bg-pine-50/40 " +
        (wide ? "w-full max-w-sm" : "")
      }
    >
      <div className="flex items-start gap-3">
        <Avatar agent={agent} size={wide ? 46 : 38} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-bold text-pine-700">{agent.displayName}</span>
            <Dot on={acted} />
          </div>
          <div className="truncate text-[12px] text-muted">{agent.title}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10.5px]">
        <span className="rounded-full bg-cream px-2 py-0.5 text-pine-700">
          {agent.skills.length} skill{agent.skills.length === 1 ? "" : "s"}
        </span>
        <span className="rounded-full bg-cream px-2 py-0.5 text-pine-700">
          {agent.tools.length} tool{agent.tools.length === 1 ? "" : "s"}
        </span>
        {agent.plannedSkills.length + agent.plannedTools.length > 0 && (
          <span className="rounded-full bg-gold-200 px-2 py-0.5 text-earth-600">
            +{agent.plannedSkills.length + agent.plannedTools.length} planned
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-[11.5px] leading-snug text-faint">{agent.owns}</p>
    </button>
  );
}

/** The three sections the specification asks for: prompt, tools, skills. */
function AgentModal({
  agent,
  connections,
  onClose,
}: {
  agent: AgentRecord;
  connections: Connection[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-pine-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line p-5">
          <Avatar agent={agent} size={48} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-pine-700">{agent.displayName}</h2>
            <p className="text-[13px] text-muted">{agent.title}</p>
            <p className="mt-1 font-mono text-[10.5px] text-faint">
              {agent.actorId} · {agent.actionCount} action{agent.actionCount === 1 ? "" : "s"} recorded
              {agent.lastActedAt
                ? ` · last ${new Date(agent.lastActedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                : " · has not acted yet"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-cream"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted">
              a · Prompt — the role definition, verbatim
            </h3>
            <p className="mt-1 text-[11.5px] text-faint">
              This is what the agent runs on. It is stored in the database, not compiled in, so a
              change to it is recorded like any other governed change.
            </p>
            <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-cream p-3 font-mono text-[10.5px] leading-relaxed text-pine-700">
              {agent.rolePrompt}
            </pre>
          </section>

          <section>
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted">
              b · Connected systems
            </h3>
            <ul className="mt-2 space-y-1">
              {connections.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-[12px]"
                >
                  <span className="text-pine-700">{c.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[10.5px] text-faint">{c.detail}</span>
                    <Dot on={c.status === "connected"} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted">
              c · Skills and tools
            </h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11.5px] font-semibold text-pine-700">
                  Built ({agent.skills.length + agent.tools.length})
                </p>
                {agent.skills.length + agent.tools.length === 0 ? (
                  <p className="mt-1 text-[11.5px] text-faint">Nothing built for this agent yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1 font-mono text-[10.5px]">
                    {agent.tools.map((t) => (
                      <li key={t} className="rounded bg-sage-100 px-2 py-1 text-sage-700">
                        {t} <span className="opacity-60">· tool</span>
                      </li>
                    ))}
                    {agent.skills.map((s) => (
                      <li key={s} className="rounded bg-pine-100 px-2 py-1 text-pine-700">
                        {s} <span className="opacity-60">· skill</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[11.5px] font-semibold text-earth-600">
                  Planned ({agent.plannedSkills.length + agent.plannedTools.length})
                </p>
                <ul className="mt-1 space-y-1 font-mono text-[10.5px]">
                  {agent.plannedTools.map((t) => (
                    <li key={t} className="rounded bg-gold-200/60 px-2 py-1 text-earth-600">
                      {t} <span className="opacity-60">· tool</span>
                    </li>
                  ))}
                  {agent.plannedSkills.map((s) => (
                    <li key={s} className="rounded bg-gold-200/60 px-2 py-1 text-earth-600">
                      {s} <span className="opacity-60">· skill</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] text-faint">
              Holding a tool is not permission to use it unattended — that is decided separately, per
              action, in the agent policy table.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
