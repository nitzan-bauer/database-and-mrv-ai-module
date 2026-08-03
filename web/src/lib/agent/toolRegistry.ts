import "server-only";
import path from "node:path";
import fs from "node:fs";
import { createSamplingPlan } from "../tools/createSamplingPlan";
import { issueWorkOrder } from "../tools/issueWorkOrder";
import { registerPddTemplate } from "../tools/registerPddTemplate";
import { runPlotQaQc } from "../tools/runPlotQaQc";
import { exportPlotsKml } from "../tools/exportPlotsKml";
import { recordBaselineSite } from "../tools/recordBaselineSite";
import { recordActivityData } from "../tools/recordActivityData";
import { recordAdditionalityAssessment } from "../tools/recordAdditionalityAssessment";
import { exportPlotsKmz } from "../tools/exportPlotsKmz";
import { generatePddDraft } from "../tools/generatePddDraft";
import { linkFarmDriveFolder, unlinkFarmDriveFolder } from "../tools/linkFarmDriveFolder";
import { listFarmDriveDocuments } from "../tools/listFarmDriveDocuments";
import { centralizeFarmDocument } from "../tools/centralizeFarmDocument";
import { computeUncertaintyDeduction } from "../tools/computeUncertaintyDeduction";
import { fail, type ToolContext, type ToolResult } from "../tools/context";
import type { ToolSchema } from "./provider";

/**
 * What a model may actually call, and how its JSON input becomes a real
 * tool invocation.
 *
 * Deliberately not every action in mrv.agent_action_policies — only the
 * ones with a handler behind them. An agent's `tools` array is the other
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

  compute_uncertainty_deduction: {
    schema: {
      name: "compute_uncertainty_deduction",
      description:
        "VM0042 Eq. 74 uncertainty deduction for a farm's most recent completed model run, area-weighted across strata from stored model + sampling variance. Returns the deduction % and the net ERR after it.",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string" },
          path: { type: "string", enum: ["analytical", "monte_carlo"], description: "Defaults to the run's own method." },
          degreesOfFreedom: { type: "number", description: "Omit for the large-sample t value." },
        },
        required: ["farmId"],
      },
    },
    handler: (ctx, input) =>
      computeUncertaintyDeduction(ctx, {
        farmId: String(input.farmId ?? ""),
        path: input.path as "analytical" | "monte_carlo" | undefined,
        degreesOfFreedom: input.degreesOfFreedom as number | undefined,
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

  record_baseline_site: {
    schema: {
      name: "record_baseline_site",
      description:
        "Record one VM0042 QA2 baseline control site for a farm: a boundary (GeoJSON or WKT), " +
        "which similarity criteria were assessed, and whether each was met. Area and the distance " +
        "to the farm's nearest plot are computed from the geometry, not supplied.",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string" },
          geometry: { type: "string", description: "GeoJSON Polygon (as a JSON string) or WKT POLYGON(...)." },
          linkedPlotId: { type: "string", description: "Optional — the plot this site is a control for." },
          criteria: {
            type: "array",
            description: "Whichever VM0042 Table 7 similarity criteria have actually been assessed.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                met: { type: "boolean" },
                note: { type: "string" },
              },
              required: ["name", "met"],
            },
          },
        },
        required: ["farmId", "geometry", "criteria"],
      },
    },
    handler: (ctx, input) =>
      recordBaselineSite(ctx, {
        farmId: String(input.farmId ?? ""),
        geometry: input.geometry as string,
        linkedPlotId: (input.linkedPlotId as string | undefined) ?? null,
        criteria: (input.criteria ?? []) as never,
      }),
  },

  record_activity_data: {
    schema: {
      name: "record_activity_data",
      description:
        "Record one farm/scenario/year of GHG Calculator activity data: fuel use, residue burning, " +
        "N-fixing cover crops, and fertilizer applications (matched against the fertilizer catalog by name).",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string" },
          scenario: { type: "string", enum: ["BSL", "PR", "WP"] },
          year: { type: "integer" },
          areaHa: { type: "number" },
          dieselL: { type: "number" },
          gasolineL: { type: "number" },
          residueBurntKg: { type: "number" },
          nfixDryMatterT: { type: "number" },
          nfixNContent: { type: "number", description: "Fraction 0-1." },
          fertilizers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fertilizerName: { type: "string", description: "Must match the mrv.fertilizers catalog exactly." },
                massT: { type: "number" },
                intervalYears: { type: "integer", description: "Default 1." },
              },
              required: ["fertilizerName", "massT"],
            },
          },
        },
        required: ["farmId", "scenario", "year", "areaHa"],
      },
    },
    handler: (ctx, input) =>
      recordActivityData(ctx, {
        farmId: String(input.farmId ?? ""),
        scenario: input.scenario as "BSL" | "PR" | "WP",
        year: Number(input.year),
        areaHa: Number(input.areaHa),
        dieselL: input.dieselL as number | undefined,
        gasolineL: input.gasolineL as number | undefined,
        residueBurntKg: input.residueBurntKg as number | undefined,
        nfixDryMatterT: input.nfixDryMatterT as number | undefined,
        nfixNContent: input.nfixNContent as number | undefined,
        fertilizers: (input.fertilizers ?? []) as never,
      }),
  },

  record_additionality_assessment: {
    schema: {
      name: "record_additionality_assessment",
      description:
        "Record a VM0042 v2.2 §7 additionality assessment for a project: regulatory surplus, " +
        "the barrier analysis, and the common-practice test (adoption below 20% passes on its own; " +
        "at or above 20%, or unknown, Step 4c must be separately demonstrated).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          regulatorySurplusMet: { type: "boolean" },
          regulatorySurplusNote: { type: "string" },
          barriers: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, description: { type: "string" } },
              required: ["name", "description"],
            },
          },
          commonPracticeRegion: { type: "string" },
          commonPracticeAdoptionPct: { type: "number", description: "0-100, or omit if unknown." },
          step4cDemonstrated: { type: "boolean" },
          step4cNote: { type: "string" },
        },
        required: ["projectId", "regulatorySurplusMet", "regulatorySurplusNote", "barriers", "commonPracticeRegion"],
      },
    },
    handler: (ctx, input) =>
      recordAdditionalityAssessment(ctx, {
        projectId: String(input.projectId ?? ""),
        regulatorySurplusMet: Boolean(input.regulatorySurplusMet),
        regulatorySurplusNote: String(input.regulatorySurplusNote ?? ""),
        barriers: (input.barriers ?? []) as never,
        commonPracticeRegion: String(input.commonPracticeRegion ?? ""),
        commonPracticeAdoptionPct:
          input.commonPracticeAdoptionPct == null ? null : Number(input.commonPracticeAdoptionPct),
        step4cDemonstrated: input.step4cDemonstrated as boolean | undefined,
        step4cNote: input.step4cNote as string | undefined,
      }),
  },

  export_plots_kmz: {
    schema: {
      name: "export_plots_kmz",
      description: "Export a KMZ file for every valid plot boundary on a farm.",
      inputSchema: {
        type: "object",
        properties: { farmId: { type: "string" } },
        required: ["farmId"],
      },
    },
    handler: (ctx, input) => exportPlotsKmz(ctx, { farmId: String(input.farmId ?? "") }),
  },

  generate_pdd_draft: {
    schema: {
      name: "generate_pdd_draft",
      description:
        "Assemble a PDD draft: the registered template's own section outline, plus an annex of " +
        "real, verified project facts (farms, boundaries, baseline sites, additionality, compliance). " +
        "No section content is invented — narrative sections are marked as needing a person.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => generatePddDraft(ctx, { projectId: String(input.projectId ?? "") }),
  },

  link_farm_drive_folder: {
    schema: {
      name: "link_farm_drive_folder",
      description:
        "Link a farm to the Google Drive folder that already holds its documents. The folder id " +
        "must come from an existing folder a person has already found in Drive — never guessed.",
      inputSchema: {
        type: "object",
        properties: { farmId: { type: "string" }, driveFolderId: { type: "string" } },
        required: ["farmId", "driveFolderId"],
      },
    },
    handler: (ctx, input) =>
      linkFarmDriveFolder(ctx, {
        farmId: String(input.farmId ?? ""),
        driveFolderId: String(input.driveFolderId ?? ""),
      }),
  },

  unlink_farm_drive_folder: {
    schema: {
      name: "unlink_farm_drive_folder",
      description: "Clear a farm's linked Drive folder mapping. Touches nothing in Drive itself.",
      inputSchema: {
        type: "object",
        properties: { farmId: { type: "string" } },
        required: ["farmId"],
      },
    },
    handler: (ctx, input) => unlinkFarmDriveFolder(ctx, { farmId: String(input.farmId ?? "") }),
  },

  list_farm_drive_documents: {
    schema: {
      name: "list_farm_drive_documents",
      description: "List the real, current files in a farm's linked Google Drive folder.",
      inputSchema: {
        type: "object",
        properties: { farmId: { type: "string" } },
        required: ["farmId"],
      },
    },
    handler: (ctx, input) => listFarmDriveDocuments(ctx, { farmId: String(input.farmId ?? "") }),
  },

  centralize_farm_document: {
    schema: {
      name: "centralize_farm_document",
      description:
        "Push a document into a farm's linked Drive folder: its own KMZ export, a PDD draft " +
        "already generated for its project, or a file already in hand (base64).",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string" },
          source: {
            type: "object",
            description: "{type:'kmz'} | {type:'pdd_draft', draftId} | {type:'custom', fileName, mimeType, contentBase64}",
          },
        },
        required: ["farmId", "source"],
      },
    },
    handler: (ctx, input) =>
      centralizeFarmDocument(ctx, {
        farmId: String(input.farmId ?? ""),
        source: input.source as never,
      }),
  },
};
