import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import type { PipelineStage } from "../data";

export interface DepartmentReportAgent {
  agentId: string;
  displayName: string;
  title: string;
  builtCount: number;
  plannedCount: number;
  actionCount: number;
  lastActedAt: string | null;
}

export interface RecentAgentAction {
  ts: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
}

export interface DepartmentReport {
  pipeline: PipelineStage[];
  agents: DepartmentReportAgent[];
  totalBuilt: number;
  totalPlanned: number;
  totalActionsRecorded: number;
  recentAgentActivity: RecentAgentAction[];
}

/**
 * John's ceo_reporting skill — the same figures the Factory control-tower
 * page already renders (creditPipeline, listAgents, the agent-only slice
 * of listAuditLog), aggregated into one report rather than recomputed.
 * totalBuilt/totalPlanned/totalActionsRecorded use the exact reductions
 * the dashboard uses, so this can never disagree with what a person sees
 * on screen.
 */
export async function getDepartmentReport(
  ctx: ToolContext,
  input: { recentActivityLimit?: number } = {},
): Promise<ToolResult<DepartmentReport>> {
  if (input.recentActivityLimit != null && !(input.recentActivityLimit > 0)) {
    return fail("getDepartmentReport: recentActivityLimit must be a positive number.");
  }
  const limit = Math.min(input.recentActivityLimit ?? 10, 50);

  const policy = await checkPolicy("get_department_report", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { creditPipeline, listAgents, listAuditLog } = await import("../data");

  const [pipeline, agentRecords, auditRows] = await Promise.all([
    creditPipeline(),
    listAgents(),
    listAuditLog(200),
  ]);

  const actorIds = new Set(agentRecords.map((a) => a.actorId));
  const recentAgentActivity: RecentAgentAction[] = auditRows
    .filter((e) => actorIds.has(e.actor))
    .slice(0, limit)
    .map((e) => ({ ts: e.ts, actor: e.actor, action: e.action, targetType: e.targetType, targetId: e.targetId }));

  const agents: DepartmentReportAgent[] = agentRecords.map((a) => ({
    agentId: a.agentId,
    displayName: a.displayName,
    title: a.title,
    builtCount: a.skills.length + a.tools.length,
    plannedCount: a.plannedSkills.length + a.plannedTools.length,
    actionCount: a.actionCount,
    lastActedAt: a.lastActedAt,
  }));

  const totalBuilt = agents.reduce((n, a) => n + a.builtCount, 0);
  const totalPlanned = agents.reduce((n, a) => n + a.plannedCount, 0);
  const totalActionsRecorded = agents.reduce((n, a) => n + a.actionCount, 0);

  await audit(ctx, "get_department_report", null, {
    agentCount: agents.length,
    totalBuilt,
    totalPlanned,
    totalActionsRecorded,
  });

  return ok({ pipeline, agents, totalBuilt, totalPlanned, totalActionsRecorded, recentAgentActivity });
}
