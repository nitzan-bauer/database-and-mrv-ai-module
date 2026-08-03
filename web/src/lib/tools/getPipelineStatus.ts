import "server-only";
import { audit, checkPolicy, fail, ok, type ToolContext, type ToolResult } from "./context";
import type { PipelineStage } from "../data";

export interface PipelineStatus {
  stages: PipelineStage[];
  /** Stages whose count is at zero, with the reason stated. */
  blocked: PipelineStage[];
}

/**
 * John's pipeline_control skill — the same credit pipeline the Factory
 * dashboard already renders (creditPipeline() in lib/data), not a second
 * computation of it. Every figure is a count of real rows, so this cannot
 * disagree with what a person sees on screen; where a stage is stuck the
 * blocker is the same sentence the dashboard already states, not a fresh
 * guess about why.
 */
export async function getPipelineStatus(ctx: ToolContext): Promise<ToolResult<PipelineStatus>> {
  const policy = await checkPolicy("get_pipeline_status", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { creditPipeline } = await import("../data");
  const stages = await creditPipeline();
  const blocked = stages.filter((s) => s.blocker !== null);

  await audit(ctx, "get_pipeline_status", null, {
    stagesReturned: stages.length,
    blockedCount: blocked.length,
  });

  return ok({ stages, blocked });
}
