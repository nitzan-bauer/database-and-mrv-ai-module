import "server-only";
import path from "node:path";
import fs from "node:fs";
import { createSamplingPlan } from "../tools/createSamplingPlan";
import { issueWorkOrder } from "../tools/issueWorkOrder";
import { registerPddTemplate } from "../tools/registerPddTemplate";
import { runPlotQaQc } from "../tools/runPlotQaQc";
import { exportPlotsKml } from "../tools/exportPlotsKml";
import { fail, type ToolContext, type ToolResult } from "../tools/context";
import type { ToolSchema } from "./provider";

/**
 * What a model may actually call, and how its JSON input becomes a real
 * tool invocation.
 *
 * Deliberately not every action in mrv.agent_action_policies — only the
 * five with a handler behind them. An agent's `tools` array is the other
 * half of the gate: the runtime offers a model only the schemas for
 * actions that agent holds, so this registry existing is not itself
 * permission to call anything.
 */
export interface RegisteredTool {
  schema: ToolSchema;
  handler: (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolResult<unknown>>;
}

/**
 * registerPddTemplate's real signature takes the template's file bytes —
 * something no model can produce through a JSON tool call. So the schema
 * offered to a model asks only for name/version/sourcePath, and this
 * wrapper reads the file itself before calling the real tool.
 *
 * sourcePath is constrained to docs/source/: without that, a model could
 * ask the server to read an arbitrary path, which is a path-traversal
 * hole dressed up as a feature. Every template this project has actually
 * used lives there already (the GHG workbook, the SOC datasheet, the PDD
 * template itself), so the restriction costs nothing real.
 */
async function registerPddTemplateFromDisk(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolResult<unknown>> {
  const name = String(input.name ?? "");
  const version = String(input.version ?? "");
  const sourcePath = String(input.sourcePath ?? "");

  const repoRoot = path.resolve(process.cwd(), "..");
  const allowedDir = path.resolve(repoRoot, "docs", "source");
  const resolved = path.resolve(repoRoot, sourcePath);

  if (!resolved.startsWith(allowedDir + path.sep)) {
    return fail("registerPddTemplate: sourcePath must be a file under docs/source/.");
  }

  let fileBytes: Buffer;
  try {
    fileBytes = fs.readFileSync(resolved);
  } catch {
    return fail(`registerPddTemplate: could not read ${sourcePath}.`);
  }

  return registerPddTemplate(ctx, { name, version, sourcePath, fileBytes });
}

export const TOOL_REGISTRY: Record<string, RegisteredTool> = {
  propose_sampling_plan: {
    schema: {
      name: "propose_sampling_plan",
      description:
        "Propose a sampling plan for a farm: strata, a cycle, and randomly placed points meeting the VM0042 composite floor.",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string", description: "The farm's UUID." },
          cycleNumber: { type: "integer", minimum: 1 },
          approach: { type: "string", enum: ["QA1_DNDC", "QA1_DAYCENT", "QA2", "QA3"] },
          plannedStart: { type: "string", description: "ISO date, optional." },
          plannedEnd: { type: "string", description: "ISO date, optional." },
        },
        required: ["farmId", "cycleNumber", "approach"],
      },
    },
    handler: (ctx, input) =>
      createSamplingPlan(ctx, {
        farmId: String(input.farmId ?? ""),
        cycleNumber: Number(input.cycleNumber),
        approach: input.approach as never,
        plannedStart: (input.plannedStart as string | undefined) ?? null,
        plannedEnd: (input.plannedEnd as string | undefined) ?? null,
      }),
  },

  send_work_order: {
    schema: {
      name: "send_work_order",
      description: "Issue a work order and a scoped access token for a sampling cycle.",
      inputSchema: {
        type: "object",
        properties: {
          cycleId: { type: "string" },
          contractorName: { type: "string" },
          contractorEmail: { type: "string" },
          windowStart: { type: "string", description: "ISO date." },
          windowEnd: { type: "string", description: "ISO date." },
        },
        required: ["cycleId", "contractorName", "windowStart", "windowEnd"],
      },
    },
    handler: (ctx, input) =>
      issueWorkOrder(ctx, {
        cycleId: String(input.cycleId ?? ""),
        contractorName: String(input.contractorName ?? ""),
        contractorEmail: (input.contractorEmail as string | undefined) ?? null,
        windowStart: String(input.windowStart ?? ""),
        windowEnd: String(input.windowEnd ?? ""),
      }),
  },

  register_pdd_template: {
    schema: {
      name: "register_pdd_template",
      description:
        "Register a Verra PDD template version from a file already checked into docs/source/.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "e.g. 'VCS Project Description Template'." },
          version: { type: "string", description: "e.g. 'v5.0A'." },
          sourcePath: { type: "string", description: "Path under docs/source/, e.g. 'docs/source/foo.docx'." },
        },
        required: ["name", "version", "sourcePath"],
      },
    },
    handler: registerPddTemplateFromDisk,
  },

  run_plot_qa_qc: {
    schema: {
      name: "run_plot_qa_qc",
      description: "Check a farm's plot boundaries and areas: geometry validity, area match, overlaps.",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string" },
          areaTolerancePct: { type: "number", description: "Default 2." },
        },
        required: ["farmId"],
      },
    },
    handler: (ctx, input) =>
      runPlotQaQc(ctx, {
        farmId: String(input.farmId ?? ""),
        areaTolerancePct: input.areaTolerancePct as number | undefined,
      }),
  },

  export_plots_kml: {
    schema: {
      name: "export_plots_kml",
      description: "Export KML for every valid plot boundary on a farm.",
      inputSchema: {
        type: "object",
        properties: { farmId: { type: "string" } },
        required: ["farmId"],
      },
    },
    handler: (ctx, input) => exportPlotsKml(ctx, { farmId: String(input.farmId ?? "") }),
  },
};
