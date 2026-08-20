import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAgent, listProjects, resolveActiveProject } from "@/lib/data";
import { DATA_MODE } from "@/lib/env";
import type { AgentTaskResult } from "@/lib/agent/runAgentTask";
import type { ToolResult } from "@/lib/tools/context";
import type { ProjectStatus, SubmittedProjectStatus } from "@/lib/tools/submitProjectStatus";
import type { SyncedPddGoogleDoc } from "@/lib/tools/syncPddGoogleDoc";
import type { UpdatedPddSeedAnswer } from "@/lib/tools/updatePddSeedAnswer";
import type { PddGeneratorPipelineResult } from "@/lib/tools/runPddGeneratorPipeline";
import { ProjectSwitcher } from "@/components/agents/ProjectSwitcher";
import { SingleAgentHeader } from "@/components/agents/SingleAgentHeader";
import { RebekaDashboard } from "@/components/agents/RebekaDashboard";
import { ComingSoonDashboard } from "@/components/agents/ComingSoonDashboard";
import { AgentFeedSection } from "@/components/agents/AgentFeedSection";

export const dynamic = "force-dynamic";

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
 * An agent's own page (Nitzan's own spec) — every agent except John, who
 * has no page of his own: the main /agents roster already doubles as his,
 * so a request for /agents/john just goes back there.
 *
 * Section 1 is the agent's block (opens the same prompt/skills/tools popup
 * the roster's first click used to) plus its own dashboard — real, built so
 * far only for Rebeka, per spec ("implement this for Rebeka; the rest of
 * the agents next"). Section 2 is its activity feed.
 */
export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { agentId } = await params;
  if (agentId === "john") redirect("/agents");

  if (DATA_MODE !== "db") {
    return (
      <div className="rounded-xl border border-line bg-white p-6">
        <p className="text-sm font-semibold text-pine-700">The department runs on the database.</p>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Agents, their prompts and their recorded actions all live in the{" "}
          <span className="font-mono text-[12px]">mrv</span> schema. There is no fixture stand-in.
        </p>
      </div>
    );
  }

  const agent = await getAgent(agentId);
  if (!agent) notFound();

  const { project: requestedProjectId } = await searchParams;
  const allProjects = await listProjects();
  const project = resolveActiveProject(allProjects, requestedProjectId);

  const { buildAgentConnections } = await import("@/lib/agent/agentConnections");
  const connections = buildAgentConnections([agent])[agent.agentId] ?? [];

  const { listAgentFeed } = await import("@/lib/agent/agentFeed");
  const feed = await listAgentFeed(agent.agentId);

  async function askAgent(id: string, task: string): Promise<AgentTaskResult> {
    "use server";
    const session = await auth().catch(() => null);
    const { runAgentTask } = await import("@/lib/agent/runAgentTask");
    return runAgentTask(id, task, {
      requestedBy: session?.user?.email ?? "unknown",
      googleAccessToken: session?.googleAccessToken,
    });
  }

  return (
    <div className="space-y-6">
      <nav className="font-mono text-[11px] text-faint">
        <a href="/agents" className="hover:text-pine-700">
          Agents
        </a>{" "}
        / {agent.displayName}
      </nav>

      {agent.agentId === "rebeka" && (
        <ProjectSwitcher projects={allProjects} activeProjectId={project.projectId} basePath={`/agents/${agent.agentId}`} />
      )}

      <SingleAgentHeader agent={agent} connections={connections} askAgent={askAgent} />

      {agent.agentId === "rebeka" ? (
        <RebekaDashboard
          projectId={project.projectId}
          currentStatus={project.status}
          googleDocUrl={project.googleDocUrl}
          pddGeneratorLockedAt={project.pddGeneratorLockedAt}
          saveAnswerAction={updateSeedAnswerAction}
          runGeneratorAction={runPddGeneratorAction}
          submitStatusAction={submitProjectStatusAction}
          syncGoogleDocAction={syncPddGoogleDocAction}
        />
      ) : (
        <ComingSoonDashboard agentName={agent.displayName} />
      )}

      <AgentFeedSection agentName={agent.displayName} items={feed} />
    </div>
  );
}
