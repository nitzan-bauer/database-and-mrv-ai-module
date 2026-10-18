import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import type { EmissionResult, GhgParameters, IrrigationMethod, WorkingLine } from "../ghg/engine";
import type { ParameterExplanation } from "../ghg/skill";

/**
 * Dave's GHG-Calculator skill (skill.ts), registered as real tools —
 * closing exactly the gap Explore found this session: GHG_TOOLS was
 * declared metadata only, never wired into TOOL_REGISTRY, so nothing
 * Dave actually held could call the GHG engine even though his own
 * role_prompt has claimed the skill all along. Every handler here calls
 * the same functions the /ghg page itself calls (engine.ts, skill.ts) —
 * never a second implementation — so Dave and the page can never
 * disagree on a number.
 *
 * All 4 need a resolved farm (climate zone, irrigation method, activity
 * data) to mean anything; explain_parameters' own GHG_TOOLS schema
 * originally declared no input at all, which cannot actually resolve a
 * parameter set on its own — corrected here to require farmId, same as
 * the other three, rather than leaving a tool that could never run.
 */
async function loadFarmContext(
  farmId: string,
): Promise<
  | { ok: true; climateZone: "wet" | "dry"; irrigation: IrrigationMethod | null; activity: Awaited<ReturnType<typeof import("../data").listActivityData>>; parameters: GhgParameters }
  | { ok: false; error: string }
> {
  const { getFarmById, listActivityData } = await import("../data");
  const farm = await getFarmById(farmId);
  if (!farm) return { ok: false, error: `No such farm "${farmId}".` };
  if (!farm.climateZone) {
    return { ok: false, error: `${farm.name} has no climate zone recorded — cannot resolve a parameter set without guessing.` };
  }
  const { resolveParameters } = await import("../ghg/engine");
  const activity = await listActivityData(farmId);
  return { ok: true, climateZone: farm.climateZone, irrigation: farm.irrigationMethod, activity, parameters: resolveParameters(farm.climateZone) };
}

export async function computeFarmYearTool(
  ctx: ToolContext,
  input: { farmId: string; scenario: "BSL" | "PR"; year?: number },
): Promise<ToolResult<{ activity: unknown; result: EmissionResult } | null>> {
  const guard = requireDbMode("compute_farm_year");
  if (guard) return guard;
  const policy = await checkPolicy("compute_farm_year", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const fc = await loadFarmContext(input.farmId);
  if (!fc.ok) return fail(`compute_farm_year: ${fc.error}`);

  const { computeFarmYear } = await import("../ghg/skill");
  const result = computeFarmYear(fc.activity, fc.parameters, fc.irrigation, input.farmId, input.scenario, input.year);
  await audit(ctx, "compute_farm_year", { type: "farm", id: input.farmId }, { scenario: input.scenario, year: input.year, found: Boolean(result) });
  return ok(result);
}

export async function explainFarmYearTool(
  ctx: ToolContext,
  input: { farmId: string; scenario: "BSL" | "PR"; year?: number },
): Promise<ToolResult<WorkingLine[] | null>> {
  const guard = requireDbMode("explain_farm_year");
  if (guard) return guard;
  const policy = await checkPolicy("explain_farm_year", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const fc = await loadFarmContext(input.farmId);
  if (!fc.ok) return fail(`explain_farm_year: ${fc.error}`);

  const { explainFarmYear } = await import("../ghg/skill");
  const working = explainFarmYear(fc.activity, fc.parameters, fc.irrigation, input.farmId, input.scenario, input.year);
  await audit(ctx, "explain_farm_year", { type: "farm", id: input.farmId }, { scenario: input.scenario, year: input.year, lines: working?.length ?? 0 });
  return ok(working);
}

export async function computeReductionTool(
  ctx: ToolContext,
  input: { farmId: string },
): Promise<
  ToolResult<{ baseline: EmissionResult; project: EmissionResult; reduction: { perHa: number; total: number }; areaHa: number } | null>
> {
  const guard = requireDbMode("compute_reduction");
  if (guard) return guard;
  const policy = await checkPolicy("compute_reduction", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const fc = await loadFarmContext(input.farmId);
  if (!fc.ok) return fail(`compute_reduction: ${fc.error}`);

  const { computeReduction } = await import("../ghg/skill");
  const reduction = computeReduction(fc.activity, fc.parameters, fc.irrigation, input.farmId);
  await audit(ctx, "compute_reduction", { type: "farm", id: input.farmId }, { found: Boolean(reduction) });
  return ok(reduction);
}

export async function explainParametersTool(
  ctx: ToolContext,
  input: { farmId: string },
): Promise<ToolResult<ParameterExplanation[]>> {
  const guard = requireDbMode("explain_parameters");
  if (guard) return guard;
  const policy = await checkPolicy("explain_parameters", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const fc = await loadFarmContext(input.farmId);
  if (!fc.ok) return fail(`explain_parameters: ${fc.error}`);

  const { explainParameters } = await import("../ghg/skill");
  const explanations = explainParameters(fc.parameters, fc.irrigation);
  await audit(ctx, "explain_parameters", { type: "farm", id: input.farmId }, { count: explanations.length });
  return ok(explanations);
}
