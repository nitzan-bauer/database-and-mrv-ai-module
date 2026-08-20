import { auth } from "@/auth";
import { creditPipeline, listAgents, listAuditLog, listProjects, pddReadiness, resolveActiveProject } from "@/lib/data";
import { ProjectSwitcher } from "@/components/agents/ProjectSwitcher";
import { ChapterReadinessBars } from "@/components/agents/ChapterReadinessBars";
import { DATA_MODE } from "@/lib/env";
import type { AgentTaskResult } from "@/lib/agent/runAgentTask";
import type { ToolResult } from "@/lib/tools/context";
import { AgentOrgChart } from "@/components/agents/AgentOrgChart";
import { ProjectStatusPanel } from "@/components/agents/ProjectStatusPanel";
import type { SubmittedProjectStatus, ProjectStatus } from "@/lib/tools/submitProjectStatus";
import { GoogleDocPanel } from "@/components/agents/GoogleDocPanel";
import type { SyncedPddGoogleDoc } from "@/lib/tools/syncPddGoogleDoc";
import { ReadinessGauge } from "@/components/agents/ReadinessGauge";
import { SeedQuestionnaireBlock } from "@/components/agents/SeedQuestionnaireBlock";
import type { UpdatedPddSeedAnswer } from "@/lib/tools/updatePddSeedAnswer";
import type { PddGeneratorPipelineResult } from "@/lib/tools/runPddGeneratorPipeline";

/** Save one SEED-questionnaire answer, as the signed-in person. */
async function updateSeedAnswerAction(input: {
  projectId: string;
  questionKey: string;
  answerText: string;
}): Promise<ToolResult<UpdatedPddSeedAnswer>> {
  "use server";
  const session = await auth().catch(() => null);
  const { updatePddSeedAnswer } = await import("@/lib/tools/updatePddSeedAnswer");
  return updatePddSeedAnswer({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

/** Run the full PDD Generator pipeline as the signed-in person. */
async function runPddGeneratorAction(input: { projectId: string }): Promise<ToolResult<PddGeneratorPipelineResult>> {
  "use server";
  const session = await auth().catch(() => null);
  const { runPddGeneratorPipeline } = await import("@/lib/tools/runPddGeneratorPipeline");
  return runPddGeneratorPipeline(
    { actor: session?.user?.email ?? "unknown", actorKind: "human", googleAccessToken: session?.googleAccessToken },
    input,
  );
}

export const dynamic = "force-dynamic";

/** Advance the project's declared VM0042 pipeline status as the signed-in person. */
async function submitProjectStatusAction(input: {
  projectId: string;
  status: ProjectStatus;
}): Promise<ToolResult<SubmittedProjectStatus>> {
  "use server";
  const session = await auth().catch(() => null);
  const { submitProjectStatus } = await import("@/lib/tools/submitProjectStatus");
  return submitProjectStatus({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

/** Create or update the project's live Google Doc, as the signed-in person's own Drive access. */
async function syncPddGoogleDocAction(input: { projectId: string }): Promise<ToolResult<SyncedPddGoogleDoc>> {
  "use server";
  const session = await auth().catch(() => null);
  const { syncPddGoogleDoc } = await import("@/lib/tools/syncPddGoogleDoc");
  return syncPddGoogleDoc(
    { actor: session?.user?.email ?? "unknown", actorKind: "human", googleAccessToken: session?.googleAccessToken },
    input,
  );
}

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
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
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

  const { project: requestedProjectId } = await searchParams;
  const allProjects = await listProjects();
  const project = resolveActiveProject(allProjects, requestedProjectId);
  const [agents, pipeline, audit, readiness] = await Promise.all([
    listAgents(),
    creditPipeline(),
    listAuditLog(200),
    pddReadiness(project.projectId),
  ]);

  // The questionnaire's own answered/total — a second, independent
  // readiness figure from what pddReadiness above reports: that one is
  // Rebeka's fixed 4-metric check (boundaries, baseline, etc.), this one
  // is the structured questionnaire's actual fill-in progress.
  const { query } = await import("@/lib/db");
  const { listPddSectionStatus, summarizeByChapter } = await import("@/lib/pdd/sectionStatus");
  const questionnaire = await listPddSectionStatus(query, project.projectId);
  const questionnaireAnswered = questionnaire?.rows.filter((r) => r.status === "answered").length ?? 0;
  const questionnaireDrafted = questionnaire?.rows.filter((r) => r.status === "drafted").length ?? 0;
  const questionnairePct = questionnaire?.rows.length
    ? Math.round((questionnaireAnswered / questionnaire.rows.length) * 100)
    : 0;
  const chapterReadiness = questionnaire ? summarizeByChapter(questionnaire.rows) : [];

  const { listSeedAnswers } = await import("@/lib/pdd/seedAnswers");
  const seedState = await listSeedAnswers(query, project.projectId);

  const actorIds = new Set(agents.map((a) => a.actorId));
  const agentActions = audit.filter((e) => actorIds.has(e.actor)).slice(0, 12);
  const byActor = new Map(agents.map((a) => [a.actorId, a]));

  const hasModelKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  // Connections are reported as they actually are, per agent — not one
  // uniform list. A tool existing in the registry is not the same as an
  // agent holding it, so "connected" here always means this specific
  // agent's own tools array includes something that reaches that system.
  const dbConn = {
    name: "Project database (mrv on RDS)",
    status: "connected" as const,
    detail: "read and write",
  };
  const DRIVE_TOOLS = ["link_farm_drive_folder", "list_farm_drive_documents", "centralize_farm_document", "unlink_farm_drive_folder"];
  const CALENDAR_TOOLS = ["check_calendar_availability", "schedule_calendar_event"];
  const CRM_TOOLS = [
    "record_lead", "update_lead_stage", "add_follow_up", "draft_outreach_message",
    "crm_hygiene", "farmer_funnel", "buyer_funnel",
  ];
  const modelConn = hasModelKey
    ? { name: "Model runtime", status: "connected" as const, detail: process.env.AGENT_MODEL_ID?.trim() || "claude-sonnet-5" }
    : { name: "Model runtime", status: "not configured" as const, detail: "no ANTHROPIC_API_KEY" };

  const connections: Record<string, Array<{ name: string; status: "connected" | "not configured"; detail: string }>> =
    Object.fromEntries(
      agents.map((a) => {
        const holds = (names: string[]) => names.some((n) => a.tools.includes(n));
        const rows: Array<{ name: string; status: "connected" | "not configured"; detail: string }> = [
          a.tools.length ? dbConn : { ...dbConn, detail: "read only — no tools held" },
        ];

        if (holds(CRM_TOOLS)) {
          rows.push({ name: "CRM database (crm schema, shared RDS)", status: "connected", detail: "read and write" });
        }
        if (holds(DRIVE_TOOLS)) {
          rows.push({ name: "Google Drive", status: "connected", detail: "as the signed-in person, via their own OAuth session" });
        }
        if (holds(CALENDAR_TOOLS)) {
          rows.push({ name: "Google Calendar", status: "connected", detail: "as the signed-in person, via their own OAuth session" });
        }
        if (a.tools.includes("list_recent_mail")) {
          rows.push({ name: "Gmail", status: "connected", detail: "read-only, as the signed-in person" });
        }
        if (a.tools.includes("fetch_public_url")) {
          rows.push({ name: "Verra registry", status: "connected", detail: "public — no credentials needed" });
        }
        rows.push(modelConn);
        return [a.agentId, rows];
      }),
    );

  /**
   * Ask an agent to do something, through the same runtime a real
   * deployment would use. Without ANTHROPIC_API_KEY this honestly
   * returns "no model configured" rather than a scripted imitation of
   * reasoning — the same rule this build applies to every other screen
   * that would otherwise show a plausible number standing in for a real
   * one.
   */
  async function askAgent(agentId: string, task: string): Promise<AgentTaskResult> {
    "use server";
    const session = await auth().catch(() => null);
    const { runAgentTask } = await import("@/lib/agent/runAgentTask");
    return runAgentTask(agentId, task, {
      requestedBy: session?.user?.email ?? "unknown",
      googleAccessToken: session?.googleAccessToken,
    });
  }

  const totalBuilt = agents.reduce((n, a) => n + a.skills.length + a.tools.length, 0);
  const totalPlanned = agents.reduce(
    (n, a) => n + a.plannedSkills.length + a.plannedTools.length,
    0,
  );

  return (
    <Frame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectSwitcher projects={allProjects} activeProjectId={project.projectId} basePath="/agents" />
        <a
          href={`/api/pdd/${encodeURIComponent(project.projectId)}/export`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-pine-600 bg-white px-3 py-1.5 text-[12px] font-bold text-pine-700 hover:bg-pine-50"
        >
          Download Drafted PDD
        </a>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {questionnaire && (
          <ReadinessGauge
            pct={questionnairePct}
            label={
              `${questionnaireAnswered}/${questionnaire.rows.length} confirmed` +
              (questionnaireDrafted ? ` · ${questionnaireDrafted} AI-drafted, awaiting your review` : "")
            }
          />
        )}
        <Stat label="Agents" value={String(agents.length)} foot="one head, four reports" />
        <Stat label="Built" value={String(totalBuilt)} foot="skills and tools that run" />
        <Stat label="Planned" value={String(totalPlanned)} foot="named in the specification" />
        <Stat
          label="Actions recorded"
          value={String(agents.reduce((n, a) => n + a.actionCount, 0))}
          foot="by an agent, in the audit log"
        />
      </div>

      <ChapterReadinessBars
        chapters={chapterReadiness}
        overall={
          questionnaire
            ? { total: questionnaire.rows.length, answered: questionnaireAnswered, drafted: questionnaireDrafted }
            : undefined
        }
      />

      <section>
        <h2 className="mb-3 text-base font-bold text-pine-700">The department</h2>
        <AgentOrgChart agents={agents} connections={connections} askAgent={askAgent} />
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
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold text-pine-700">PDD readiness — Rebeka</h2>
          <a
            href={`/pdd-development?project=${encodeURIComponent(project.projectId)}`}
            className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-pine-700 hover:bg-cream"
          >
            Open PDD Development →
          </a>
        </div>

        <div className="mb-4">
          <SeedQuestionnaireBlock
            projectId={project.projectId}
            projectName={seedState.projectName}
            rows={seedState.rows}
            autoFacts={seedState.autoFacts}
            pendingCount={seedState.pendingCount}
            lockedAt={project.pddGeneratorLockedAt}
            saveAnswerAction={updateSeedAnswerAction}
            runGeneratorAction={runPddGeneratorAction}
          />
        </div>

        <p className="mb-3 max-w-3xl text-[13px] text-muted">
          Not a check against the wording of any one template — that would mean assuming what an
          arbitrary section title requires, which is exactly what storing the template as data was
          meant to avoid. This is the small set of things Rebeka is responsible for regardless of
          template version: described farms, clean boundaries, a defined baseline, an evaluated
          cycle.
        </p>
        {readiness.template && (
          <p className="mb-3 font-mono text-[11px] text-faint">
            template on file: {readiness.template.name} {readiness.template.version} ·{" "}
            {readiness.template.sectionCount} sections · registered{" "}
            {new Date(readiness.template.registeredAt).toLocaleDateString("en-GB", {
              dateStyle: "medium",
            })}
          </p>
        )}
        {readiness.items.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-5">
            <p className="text-[13px] font-semibold text-pine-700">No farms in this project yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            {readiness.items.map((it, i) => {
              const complete = it.total > 0 && it.ready === it.total;
              return (
                <div
                  key={it.key}
                  className={"px-4 py-2.5 " + (i > 0 ? "border-t border-line" : "")}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="w-44 shrink-0 text-[13px] font-semibold text-pine-700">
                      {it.label}
                    </span>
                    <span
                      className={
                        "w-16 shrink-0 text-right font-mono text-[15px] font-bold " +
                        (complete ? "text-sage-700" : it.ready > 0 ? "text-earth-600" : "text-faint")
                      }
                    >
                      {it.ready}/{it.total}
                    </span>
                    <span className="text-[11.5px] text-faint">{it.detail}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 space-y-3">
          <ProjectStatusPanel
            projectId={project.projectId}
            currentStatus={project.status}
            action={submitProjectStatusAction}
          />
          <GoogleDocPanel
            projectId={project.projectId}
            googleDocUrl={project.googleDocUrl}
            action={syncPddGoogleDocAction}
          />
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
