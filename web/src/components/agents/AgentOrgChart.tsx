"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { AgentRecord } from "@/lib/data";
import type { AgentTaskResult } from "@/lib/agent/runAgentTask";
import { extractAttachmentText } from "@/lib/agent/extractAttachmentText";
import { AgentAvatar } from "./AgentAvatar";

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
  askAgent,
}: {
  agents: AgentRecord[];
  connections: Record<string, Connection[]>;
  askAgent?: (agentId: string, task: string) => Promise<AgentTaskResult>;
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
          <AgentBlock key={a.agentId} agent={a} href={`/agents/${a.agentId}`} />
        ))}
      </div>

      <p className="mt-4 font-mono text-[10.5px] text-faint">
        <Dot on /> has acted &nbsp;·&nbsp; <Dot /> idle &nbsp;·&nbsp; counts are what exists today,
        not the specification target &nbsp;·&nbsp; click an agent for its prompt, tools and skills
      </p>

      {open && (
        <AgentModal
          agent={open}
          connections={connections[open.agentId] ?? []}
          askAgent={askAgent}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function PaperclipIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function Dot({ on = false }: { on?: boolean }) {
  return (
    <span
      className={"inline-block h-2 w-2 rounded-full align-middle " + (on ? "bg-sage-500" : "bg-line")}
    />
  );
}

/**
 * Either a modal-opening button (John, on the main page — he has no page of
 * his own to go to) or a link to that agent's own page (everyone else, on
 * the main page — first click navigates, per spec). `SingleAgentHeader`
 * below reuses this in its third mode: on an agent's own page, this same
 * block always opens the modal, since there's nowhere further to navigate.
 */
export function AgentBlock({
  agent,
  wide = false,
  onOpen,
  href,
}: {
  agent: AgentRecord;
  wide?: boolean;
  onOpen?: () => void;
  href?: string;
}) {
  const acted = agent.actionCount > 0;
  const content = (
    <>
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={agent.agentId} hue={agent.avatarHue} size={wide ? 46 : 38} />
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
    </>
  );
  const className =
    "block rounded-xl border border-line bg-white p-4 text-left transition-colors hover:border-pine-300 hover:bg-pine-50/40 " +
    (wide ? "w-full max-w-sm" : "");

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  );
}

/** The three sections the specification asks for — prompt, tools, skills — plus a fourth: actually asking it something. */
export function AgentModal({
  agent,
  connections,
  askAgent,
  onClose,
}: {
  agent: AgentRecord;
  connections: Connection[];
  askAgent?: (agentId: string, task: string) => Promise<AgentTaskResult>;
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
          <AgentAvatar agentId={agent.agentId} hue={agent.avatarHue} size={48} />
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

          {askAgent && <AskAgentPanel agent={agent} askAgent={askAgent} />}
        </div>
      </div>
    </div>
  );
}

/**
 * A real call through the runtime, not a scripted demo of one. Whatever
 * comes back is exactly what a deployment with the current configuration
 * would produce — including, right now, an honest "no model configured"
 * when there is no API key, rather than a canned response standing in
 * for reasoning that did not happen.
 */
function AskAgentPanel({
  agent,
  askAgent,
}: {
  agent: AgentRecord;
  askAgent: (agentId: string, task: string) => Promise<AgentTaskResult>;
}) {
  const [task, setTask] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AgentTaskResult | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; content: string; truncated: boolean } | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // readAsDataURL yields "data:<mime>;base64,<data>" — only the part after the comma is the payload.
        const result = String(reader.result ?? "");
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttachmentError(null);
    setReadingFile(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await extractAttachmentText({ name: file.name, base64 });
      if (result.ok) {
        setAttachment({ name: file.name, content: result.data.text, truncated: result.data.truncated });
      } else {
        setAttachmentError(result.error);
      }
    } catch (err) {
      setAttachmentError(`Could not read "${file.name}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReadingFile(false);
    }
  }

  function buildTask(): string {
    if (!attachment) return task.trim();
    const header = `Attached file: ${attachment.name}${attachment.truncated ? " (truncated)" : ""}`;
    const fileBlock = `${header}\n\n${attachment.content}`;
    return task.trim() ? `${task.trim()}\n\n${fileBlock}` : fileBlock;
  }

  return (
    <section>
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted">
        d · Ask {agent.displayName}
      </h3>
      <p className="mt-1 text-[11.5px] text-faint">
        Runs the real turn: {agent.displayName}&apos;s own prompt, restricted to the {agent.tools.length}{" "}
        tool{agent.tools.length === 1 ? "" : "s"} listed above, whatever model provider this
        deployment is actually configured with.
      </p>

      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder={`e.g. "Run boundary QA/QC on Elad Farm"`}
        rows={2}
        className="mt-2 w-full rounded-lg border border-line bg-white p-2 text-[12.5px]"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,.tsv,.json,.md,.log,.yaml,.yml,.docx,.xlsx,.pdf,text/plain,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          disabled={readingFile}
          onClick={() => fileInputRef.current?.click()}
          title="Attach a file (.txt, .csv, .md, .json, .docx, .xlsx, .pdf) — its text is added to the message below"
          className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted transition-colors hover:border-pine-300 hover:text-pine-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PaperclipIcon />
          {readingFile ? "Reading…" : "Attach"}
        </button>

        {attachment && (
          <span className="flex items-center gap-1.5 rounded-full bg-pine-50 px-2.5 py-1 text-[11px] text-pine-700">
            <PaperclipIcon className="h-3 w-3" />
            <span className="max-w-[160px] truncate">{attachment.name}</span>
            {attachment.truncated && <span className="text-earth-600">(truncated)</span>}
            <button
              type="button"
              onClick={() => setAttachment(null)}
              aria-label={`Remove ${attachment.name}`}
              className="text-faint hover:text-danger"
            >
              ×
            </button>
          </span>
        )}

        <button
          type="button"
          disabled={(!task.trim() && !attachment) || pending}
          onClick={() =>
            start(async () => {
              setResult(await askAgent(agent.agentId, buildTask()));
            })
          }
          className="ml-auto rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Asking…" : "Ask"}
        </button>
      </div>
      {attachmentError && <p className="mt-1.5 text-[11px] text-danger">{attachmentError}</p>}

      {result && (
        <div className="mt-3 rounded-lg border border-line bg-cream p-3 text-[12px]">
          <p className="font-mono text-[10px] text-faint">provider: {result.providerId}</p>
          {result.outcome.kind === "text" && <p className="mt-1 text-pine-700">{result.outcome.text}</p>}
          {result.outcome.kind === "executed" && (
            <>
              <p className="mt-1 font-semibold text-sage-700">
                executed {result.outcome.action}
              </p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10.5px] text-pine-700">
                {JSON.stringify(result.outcome.result, null, 2)}
              </pre>
            </>
          )}
          {result.outcome.kind === "needs_confirmation" && (
            <p className="mt-1 text-earth-600">
              held for approval — {result.outcome.action}: {result.outcome.reason}
            </p>
          )}
          {result.outcome.kind === "error" && (
            <p className="mt-1 text-danger">{result.outcome.message}</p>
          )}
        </div>
      )}
    </section>
  );
}
