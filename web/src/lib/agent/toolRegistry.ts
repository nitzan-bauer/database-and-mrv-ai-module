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
import { recordGroupedProjectDesign } from "../tools/recordGroupedProjectDesign";
import { recordPublicComment } from "../tools/recordPublicComment";
import { getPipelineStatus } from "../tools/getPipelineStatus";
import { getDepartmentReport } from "../tools/getDepartmentReport";
import { ingestModelResults } from "../tools/ingestModelResults";
import { recordMvrSignoff } from "../tools/recordMvrSignoff";
import { checkCreditAllocation } from "../tools/checkCreditAllocation";
import { recordAgentMemory } from "../tools/recordAgentMemory";
import { recallAgentMemory } from "../tools/recallAgentMemory";
import { fetchPublicUrl } from "../tools/fetchPublicUrl";
import { browseWebsite } from "../tools/browseWebsite";
import { sendEmail } from "../tools/sendEmail";
import { recordVvbFinding } from "../tools/recordVvbFinding";
import { resolveVvbFinding } from "../tools/resolveVvbFinding";
import { recordPddForecast } from "../tools/recordPddForecast";
import { getForecastVsActual } from "../tools/getForecastVsActual";
import { submitProjectStatus } from "../tools/submitProjectStatus";
import { researchPddPrecedents } from "../tools/researchPddPrecedents";
import { searchVerraRegistry } from "../tools/searchVerraRegistry";
import { syncPddGoogleDoc } from "../tools/syncPddGoogleDoc";
import { updatePddSectionStatus } from "../tools/updatePddSectionStatus";
import { runPddGeneratorPipeline } from "../tools/runPddGeneratorPipeline";
import { importSaasProjectFarms } from "../tools/importSaasProjectFarms";
import { draftPddChapterContent } from "../tools/draftPddChapterContent";
import { downloadRelatedPdds } from "../tools/downloadRelatedPdds";
import { ingestRelatedPddPrecedents } from "../tools/ingestRelatedPddPrecedents";
import { researchProjectKickoffDate } from "../tools/researchProjectKickoffDate";
import { compileEligibilityEvidencePack } from "../tools/compileEligibilityEvidencePack";
import { updatePddSeedAnswer } from "../tools/updatePddSeedAnswer";
import { recordLead } from "../tools/recordLead";
import { updateCrmLeadStage } from "../tools/updateCrmLeadStage";
import { addCrmFollowUp } from "../tools/addCrmFollowUp";
import { draftOutreachMessage } from "../tools/draftOutreachMessage";
import { checkCrmHygiene } from "../tools/checkCrmHygiene";
import { getFarmerFunnel, getBuyerFunnel } from "../tools/getCrmFunnel";
import { checkCalendarAvailability } from "../tools/checkCalendarAvailability";
import { scheduleCalendarEvent } from "../tools/scheduleCalendarEvent";
import { listRecentMail } from "../tools/listRecentMail";
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

  ingest_model_results: {
    schema: {
      name: "ingest_model_results",
      description:
        "Ingest a DNDC/DayCent run that already happened outside this repo — never simulates or computes a " +
        "stock-change figure itself, only records one a real external run produced. The model's own output " +
        "file is required as source evidence. Every stratum in the rows must belong to this farm.",
      inputSchema: {
        type: "object",
        properties: {
          farmId: { type: "string" },
          cycleId: { type: "string" },
          model: { type: "string", enum: ["DNDC", "DayCent"] },
          modelVersion: { type: "string" },
          parameterSet: { type: "string" },
          runType: { type: "string", description: "e.g. 'baseline_init' | 'true_up' | 'verification' | 'recalibrate'." },
          scenario: { type: "string", enum: ["baseline", "project", "paired"], description: "Defaults to 'paired'." },
          periodStart: { type: "string", description: "ISO date." },
          periodEnd: { type: "string", description: "ISO date." },
          uncertaintyMethod: { type: "string", enum: ["analytical", "monte_carlo"] },
          monteCarloIters: { type: "number" },
          outputFileUrl: { type: "string", description: "The model's own output file — kept as source evidence." },
          outputFileSha256: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stratumId: { type: "string" },
                deltaSocWpTHa: { type: "number" },
                deltaSocBslTHa: { type: "number" },
                varModel: { type: "number" },
                varSampling: { type: "number" },
              },
              required: ["stratumId"],
            },
          },
        },
        required: ["farmId", "model", "uncertaintyMethod", "outputFileUrl", "rows"],
      },
    },
    handler: (ctx, input) =>
      ingestModelResults(ctx, {
        farmId: String(input.farmId ?? ""),
        cycleId: input.cycleId as string | undefined,
        model: input.model as "DNDC" | "DayCent",
        modelVersion: input.modelVersion as string | undefined,
        parameterSet: input.parameterSet as string | undefined,
        runType: input.runType as string | undefined,
        scenario: input.scenario as "baseline" | "project" | "paired" | undefined,
        periodStart: input.periodStart as string | undefined,
        periodEnd: input.periodEnd as string | undefined,
        uncertaintyMethod: input.uncertaintyMethod as "analytical" | "monte_carlo",
        monteCarloIters: input.monteCarloIters as number | undefined,
        outputFileUrl: String(input.outputFileUrl ?? ""),
        outputFileSha256: input.outputFileSha256 as string | undefined,
        rows: (input.rows ?? []) as never,
      }),
  },

  record_mvr_signoff: {
    schema: {
      name: "record_mvr_signoff",
      description:
        "Record the VMD0053 Model Validation Report + IME sign-off for a model run. bias_within_pmu and " +
        "coverage_pass are computed here from the given inputs, not asked of the caller. ime_contracted_by must " +
        "be 'VVB' — the IME is always contracted by the VVB, never the proponent.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          meanBias: { type: "number" },
          pooledMeasUnc: { type: "number", description: "Pooled measurement uncertainty (PMU)." },
          coveragePct: { type: "number", description: "0-100." },
          imeName: { type: "string" },
          imeContractedBy: { type: "string", description: "Must be 'VVB'; defaults to 'VVB'." },
          documentUrl: { type: "string", description: "The MVR document itself." },
          imeReportUrl: { type: "string" },
          registryUrl: { type: "string", description: "Public Verra registry link." },
          signedAt: { type: "string", description: "ISO date/time." },
        },
        required: ["runId"],
      },
    },
    handler: (ctx, input) =>
      recordMvrSignoff(ctx, {
        runId: String(input.runId ?? ""),
        meanBias: input.meanBias as number | undefined,
        pooledMeasUnc: input.pooledMeasUnc as number | undefined,
        coveragePct: input.coveragePct as number | undefined,
        imeName: input.imeName as string | undefined,
        imeContractedBy: input.imeContractedBy as string | undefined,
        documentUrl: input.documentUrl as string | undefined,
        imeReportUrl: input.imeReportUrl as string | undefined,
        registryUrl: input.registryUrl as string | undefined,
        signedAt: input.signedAt as string | undefined,
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

  record_grouped_project_design: {
    schema: {
      name: "record_grouped_project_design",
      description:
        "Record one eligibility area of a grouped project — VCS PDD Template v5.0A's own 'Grouped Project Design' " +
        "section: the area (id shaped '[Project ID]_EA[N]', e.g. '9001_EA1') plus the criteria for adding a new " +
        "instance on each of the template's five axes (uniquely identifiable, baseline scenario, additionality, " +
        "technology or measure, methodology applicability conditions). Refuses on a non-grouped project.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          areaId: { type: "string", description: "e.g. '9001_EA1'." },
          summary: { type: "string", description: "Boundary, activities/methodology, initial instances." },
          criteria: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "uniquely_identifiable",
                    "baseline_scenario",
                    "additionality",
                    "technology_or_measure",
                    "methodology_applicability_conditions",
                  ],
                },
                text: { type: "string" },
              },
              required: ["type", "text"],
            },
          },
        },
        required: ["projectId", "areaId", "summary", "criteria"],
      },
    },
    handler: (ctx, input) =>
      recordGroupedProjectDesign(ctx, {
        projectId: String(input.projectId ?? ""),
        areaId: String(input.areaId ?? ""),
        summary: String(input.summary ?? ""),
        criteria: (input.criteria ?? []) as never,
      }),
  },

  record_public_comment: {
    schema: {
      name: "record_public_comment",
      description:
        "Record one public comment — VCS PDD Template v5.0A's own 'Public Comments' table: the comment, when it " +
        "was received, whether it arrived after the comment period, and the actions taken (or the justification " +
        "for why none were needed).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          commentText: { type: "string" },
          receivedAt: { type: "string", description: "ISO date." },
          isAfterCommentPeriod: { type: "boolean" },
          actionsTaken: { type: "string" },
        },
        required: ["projectId", "commentText", "receivedAt", "actionsTaken"],
      },
    },
    handler: (ctx, input) =>
      recordPublicComment(ctx, {
        projectId: String(input.projectId ?? ""),
        commentText: String(input.commentText ?? ""),
        receivedAt: String(input.receivedAt ?? ""),
        isAfterCommentPeriod: input.isAfterCommentPeriod as boolean | undefined,
        actionsTaken: String(input.actionsTaken ?? ""),
      }),
  },

  get_pipeline_status: {
    schema: {
      name: "get_pipeline_status",
      description:
        "The credit pipeline as it actually stands: every stage from farms enrolled through VCUs issued, each a " +
        "count of real rows, with the reason stated for any stage stuck at zero.",
      inputSchema: { type: "object", properties: {} },
    },
    handler: (ctx) => getPipelineStatus(ctx),
  },

  get_department_report: {
    schema: {
      name: "get_department_report",
      description:
        "A department-wide report: the credit pipeline, every agent's built/planned counts and action count, " +
        "and the most recent agent-actor-only audit log entries. The same figures the control-tower dashboard " +
        "renders, aggregated into one call.",
      inputSchema: {
        type: "object",
        properties: {
          recentActivityLimit: { type: "number", description: "Default 10, max 50." },
        },
      },
    },
    handler: (ctx, input) =>
      getDepartmentReport(ctx, {
        recentActivityLimit: input.recentActivityLimit as number | undefined,
      }),
  },

  credit_allocation_qa: {
    schema: {
      name: "credit_allocation_qa",
      description:
        "Read-only QA over a project's real mrv.credits and mrv.vcu_issuances: application area vs plot area, " +
        "duplicate plot/activity/vintage combinations, issued credits missing a vintage, and VCUs issued beyond " +
        "what the project's own credits support per vintage.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => checkCreditAllocation(ctx, { projectId: String(input.projectId ?? "") }),
  },

  record_agent_memory: {
    schema: {
      name: "record_agent_memory",
      description:
        "Write one note to shared, cross-agent long-term memory (Voyage AI embedding, semantically recallable " +
        "by any agent). Not per-agent — any other agent working the same project or farm can recall it.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          content: { type: "string" },
          farmId: { type: "string" },
          kind: { type: "string", description: "e.g. 'note' | 'finding' | 'decision'. Defaults to 'long_term'." },
          metadata: { type: "object" },
        },
        required: ["projectId", "content"],
      },
    },
    handler: (ctx, input) =>
      recordAgentMemory(ctx, {
        projectId: String(input.projectId ?? ""),
        content: String(input.content ?? ""),
        farmId: input.farmId as string | undefined,
        kind: input.kind as string | undefined,
        metadata: input.metadata as Record<string, unknown> | undefined,
      }),
  },

  recall_agent_memory: {
    schema: {
      name: "recall_agent_memory",
      description:
        "Semantic search over shared agent memory — embeds the query (Voyage AI) and ranks stored notes by " +
        "cosine distance. Optional projectId/farmId/kind narrow the search. Relevant past lessons for THIS " +
        "conversation are already folded into your system prompt automatically before every turn — do not call " +
        "this reflexively or as a substitute for actually answering the question asked (its raw JSON result is " +
        "not itself an answer). Call it only when you genuinely need a targeted memory search beyond what's " +
        "already been surfaced to you.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          projectId: { type: "string" },
          farmId: { type: "string" },
          kind: { type: "string" },
          limit: { type: "number", description: "Default 5, max 20." },
        },
        required: ["query"],
      },
    },
    handler: (ctx, input) =>
      recallAgentMemory(ctx, {
        query: String(input.query ?? ""),
        projectId: input.projectId as string | undefined,
        farmId: input.farmId as string | undefined,
        kind: input.kind as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },

  fetch_public_url: {
    schema: {
      name: "fetch_public_url",
      description:
        "Fetch one public https:// URL and return its real, visible text — e.g. a Verra registry project page " +
        "or a methodology update. Never a substitute for reading it: returns what the page actually says, " +
        "truncated if long, not a summary invented from the URL alone.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    handler: (ctx, input) => fetchPublicUrl(ctx, { url: String(input.url ?? "") }),
  },

  browse_website: {
    schema: {
      name: "browse_website",
      description:
        "Explore a real site beyond a single page — fetches a start URL, then follows its same-origin links to " +
        "gather up to maxPages pages total (default 5, max 8). Use this instead of fetch_public_url when the " +
        "task needs more than one page of a site, e.g. a product catalog or a set of related pages.",
      inputSchema: {
        type: "object",
        properties: {
          startUrl: { type: "string" },
          maxPages: { type: "number", description: "1-8, default 5." },
        },
        required: ["startUrl"],
      },
    },
    handler: (ctx, input) =>
      browseWebsite(ctx, {
        startUrl: String(input.startUrl ?? ""),
        maxPages: typeof input.maxPages === "number" ? input.maxPages : undefined,
      }),
  },

  send_email: {
    schema: {
      name: "send_email",
      description:
        "Send a real email to nitzan@carbonature.io with a subject and a free-form body — for a finding or " +
        "report that doesn't fit an existing pipeline. Not for a project's PDD PDF (use " +
        "run_pdd_generator_pipeline for that) — this sends plain text only, no attachment.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["subject", "body"],
      },
    },
    handler: (ctx, input) => sendEmail(ctx, { subject: String(input.subject ?? ""), body: String(input.body ?? "") }),
  },

  record_vvb_finding: {
    schema: {
      name: "record_vvb_finding",
      description:
        "Record one VVB finding — a Corrective Action Request (CAR), Clarification Request (CR), Forward " +
        "Action Request (FAR), or other, per the VCS Joint Validation & Verification Report Template. Logs " +
        "real correspondence already received; does not simulate the VVB or send anything.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          stage: { type: "string", enum: ["validation", "verification"] },
          findingType: { type: "string", enum: ["CAR", "CR", "FAR", "other"] },
          issueRaised: { type: "string" },
          raisedBy: { type: "string", description: "The VVB's own name or reference." },
          raisedAt: { type: "string", description: "ISO date." },
        },
        required: ["projectId", "stage", "findingType", "issueRaised"],
      },
    },
    handler: (ctx, input) =>
      recordVvbFinding(ctx, {
        projectId: String(input.projectId ?? ""),
        stage: input.stage as "validation" | "verification",
        findingType: input.findingType as "CAR" | "CR" | "FAR" | "other",
        issueRaised: String(input.issueRaised ?? ""),
        raisedBy: input.raisedBy as string | undefined,
        raisedAt: input.raisedAt as string | undefined,
      }),
  },

  resolve_vvb_finding: {
    schema: {
      name: "resolve_vvb_finding",
      description:
        "Resolve one open VVB finding with the proponent's real response and the final conclusion, both " +
        "required. Refuses if the finding does not exist or is already resolved.",
      inputSchema: {
        type: "object",
        properties: {
          findingId: { type: "string" },
          response: { type: "string" },
          conclusion: { type: "string" },
        },
        required: ["findingId", "response", "conclusion"],
      },
    },
    handler: (ctx, input) =>
      resolveVvbFinding(ctx, {
        findingId: String(input.findingId ?? ""),
        response: String(input.response ?? ""),
        conclusion: String(input.conclusion ?? ""),
      }),
  },

  record_pdd_forecast: {
    schema: {
      name: "record_pdd_forecast",
      description:
        "Record one vintage period of the VCS PDD Template v5.0A's own 'estimated net reductions and removals' " +
        "table — the PDD's declared forecast. Revisable: recording the same vintage again updates it.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          vintageStart: { type: "string", description: "ISO date." },
          vintageEnd: { type: "string", description: "ISO date." },
          estimatedNetTco2e: { type: "number" },
        },
        required: ["projectId", "vintageStart", "vintageEnd", "estimatedNetTco2e"],
      },
    },
    handler: (ctx, input) =>
      recordPddForecast(ctx, {
        projectId: String(input.projectId ?? ""),
        vintageStart: String(input.vintageStart ?? ""),
        vintageEnd: String(input.vintageEnd ?? ""),
        estimatedNetTco2e: Number(input.estimatedNetTco2e),
      }),
  },

  get_forecast_vs_actual: {
    schema: {
      name: "get_forecast_vs_actual",
      description:
        "Reconcile the PDD's own declared forecast (per vintage) against real mrv.credits (issued/retired/sold) " +
        "for the same vintage year — the same 'actual' standing credit_allocation_qa uses. Refuses if no " +
        "forecast has been recorded yet.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => getForecastVsActual(ctx, { projectId: String(input.projectId ?? "") }),
  },

  submit_project_status: {
    schema: {
      name: "submit_project_status",
      description:
        "Move a project forward through the VM0042 pipeline stages (under_development -> registered -> " +
        "validated -> verified) and record who declared it. Not a call to Verra — Verra has no public " +
        "submission API; the real filing still happens by hand. Refuses to move a project backward.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          status: { type: "string", enum: ["under_development", "registered", "validated", "verified"] },
          note: { type: "string", description: "Optional context for the audit trail." },
        },
        required: ["projectId", "status"],
      },
    },
    handler: (ctx, input) =>
      submitProjectStatus(ctx, {
        projectId: String(input.projectId ?? ""),
        status: input.status as never,
        note: input.note as string | undefined,
      }),
  },

  research_pdd_precedents: {
    schema: {
      name: "research_pdd_precedents",
      description:
        "Search real, issued VM0042 PDDs for precedent — the closest projects by crop, geography, " +
        "climate, activities or approach. Indexes the local precedent folder incrementally (only new or " +
        "changed files), then searches its extracted text. Not a live Verra registry crawl — " +
        "registry.verra.org is a client-rendered app a raw fetch cannot read.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "e.g. 'orchard drip irrigation Israel'. Omit to list the most recently indexed." },
          limit: { type: "number", description: "Default 5, max 20." },
        },
      },
    },
    handler: (ctx, input) =>
      researchPddPrecedents(ctx, {
        query: input.query as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },

  search_verra_registry: {
    schema: {
      name: "search_verra_registry",
      description:
        "Live search over Verra's own real project registry API (registry.verra.org's own data source, " +
        "not a guess) — filter by methodology (default VM0042), status (e.g. 'Registered', 'Rejected by " +
        "Administrator', 'Under validation'), or a project-name keyword. Distinguishes rejected/denied " +
        "projects (what not to do) from registered ones (real precedent). Every match is saved to a local " +
        "snapshot, so isNew means genuinely new since the last time this was run.",
      inputSchema: {
        type: "object",
        properties: {
          methodology: { type: "string", description: "Default 'VM0042'." },
          query: { type: "string", description: "Project-name keyword, e.g. 'mycorrhizae'." },
          status: { type: "string", description: "e.g. 'Registered', 'Rejected', 'Under validation'." },
          limit: { type: "number", description: "Default 20, max 100." },
        },
      },
    },
    handler: (ctx, input) =>
      searchVerraRegistry(ctx, {
        methodology: input.methodology as string | undefined,
        query: input.query as string | undefined,
        status: input.status as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },

  sync_pdd_google_doc: {
    schema: {
      name: "sync_pdd_google_doc",
      description:
        "Create (first call) or update (later calls) a real Google Doc with the project's current PDD " +
        "draft — the live, editable document, not the read-only preview. Requires the signed-in person's " +
        "own Drive access; writes to their own Drive.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => syncPddGoogleDoc(ctx, { projectId: String(input.projectId ?? "") }),
  },

  update_pdd_section_status: {
    schema: {
      name: "update_pdd_section_status",
      description:
        "Answer, skip, or reset one section of the structured PDD questionnaire (0-indexed position in the " +
        "registered template's own outline). Both Rebeka and a person write to the same rows.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          templateId: { type: "string" },
          sectionIndex: { type: "number" },
          status: { type: "string", enum: ["pending", "answered", "skipped"] },
          inputText: { type: "string" },
        },
        required: ["projectId", "templateId", "sectionIndex", "status"],
      },
    },
    handler: (ctx, input) =>
      updatePddSectionStatus(ctx, {
        projectId: String(input.projectId ?? ""),
        templateId: String(input.templateId ?? ""),
        sectionIndex: Number(input.sectionIndex),
        status: input.status as never,
        inputText: input.inputText as string | undefined,
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

  record_lead: {
    schema: {
      name: "record_lead",
      description:
        "Record a new CRM lead — Farmer or Credit Buyer — at that type's first pipeline stage. " +
        "Writes to the crm schema on the shared RDS instance, not mrv.",
      inputSchema: {
        type: "object",
        properties: {
          leadType: { type: "string", enum: ["farmer", "credit_buyer"] },
          fullName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          companyName: { type: "string" },
          farmId: { type: "string", description: "Link to the SaaS record, once known." },
          leadSource: { type: "string", description: "e.g. 'hubspot', 'manual', a campaign name." },
        },
        required: ["leadType", "fullName"],
      },
    },
    handler: (ctx, input) =>
      recordLead(ctx, {
        leadType: input.leadType as "farmer" | "credit_buyer",
        fullName: String(input.fullName ?? ""),
        email: input.email ? String(input.email) : undefined,
        phone: input.phone ? String(input.phone) : undefined,
        companyName: input.companyName ? String(input.companyName) : undefined,
        farmId: input.farmId ? String(input.farmId) : undefined,
        leadSource: input.leadSource ? String(input.leadSource) : undefined,
      }),
  },

  update_lead_stage: {
    schema: {
      name: "update_lead_stage",
      description: "Move a CRM lead to a different pipeline stage, recording the change in crm.stage_history.",
      inputSchema: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          toStage: { type: "string", description: "Must be one of that lead's own pipeline_stages." },
        },
        required: ["leadId", "toStage"],
      },
    },
    handler: (ctx, input) =>
      updateCrmLeadStage(ctx, { leadId: String(input.leadId ?? ""), toStage: String(input.toStage ?? "") }),
  },

  add_follow_up: {
    schema: {
      name: "add_follow_up",
      description: "Add an open follow-up task to a CRM lead.",
      inputSchema: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          description: { type: "string" },
          dueAt: { type: "string", description: "ISO date, optional." },
        },
        required: ["leadId", "description"],
      },
    },
    handler: (ctx, input) =>
      addCrmFollowUp(ctx, {
        leadId: String(input.leadId ?? ""),
        description: String(input.description ?? ""),
        dueAt: input.dueAt ? String(input.dueAt) : undefined,
      }),
  },

  draft_outreach_message: {
    schema: {
      name: "draft_outreach_message",
      description:
        "Draft an outreach message to a CRM lead. Always lands as pending_approval — nothing in this " +
        "registry can approve its own draft; only a human, in the CRM app's approval queue, can.",
      inputSchema: {
        type: "object",
        properties: {
          leadId: { type: "string" },
          channel: { type: "string", description: "e.g. 'email', 'linkedin'." },
          subject: { type: "string", description: "Required in practice for channel='email' — sending refuses without one." },
          body: { type: "string" },
        },
        required: ["leadId", "channel", "body"],
      },
    },
    handler: (ctx, input) =>
      draftOutreachMessage(ctx, {
        leadId: String(input.leadId ?? ""),
        channel: String(input.channel ?? ""),
        subject: input.subject ? String(input.subject) : undefined,
        body: String(input.body ?? ""),
      }),
  },

  crm_hygiene: {
    schema: {
      name: "crm_hygiene",
      description:
        "Read-only QA over crm.leads: duplicate emails, leads with no stage change in staleDays " +
        "(default 14) that haven't already reached their pipeline's last stage, and leads with " +
        "neither an email nor a phone. Flags issues for a human to act on — never merges or deletes.",
      inputSchema: {
        type: "object",
        properties: {
          staleDays: { type: "number", description: "Default 14." },
        },
      },
    },
    handler: (ctx, input) => checkCrmHygiene(ctx, { staleDays: input.staleDays as number | undefined }),
  },

  farmer_funnel: {
    schema: {
      name: "farmer_funnel",
      description: "Farmer-acquisition funnel: lead count and conversion rate per pipeline stage, from real crm.leads rows.",
      inputSchema: { type: "object", properties: {} },
    },
    handler: (ctx) => getFarmerFunnel(ctx),
  },

  buyer_funnel: {
    schema: {
      name: "buyer_funnel",
      description: "Credit-buyer acquisition funnel: lead count and conversion rate per pipeline stage, from real crm.leads rows.",
      inputSchema: { type: "object", properties: {} },
    },
    handler: (ctx) => getBuyerFunnel(ctx),
  },

  check_calendar_availability: {
    schema: {
      name: "check_calendar_availability",
      description:
        "Read-only: candidate free 30-minute slots (9am-5pm workdays) on the requester's own primary " +
        "Google Calendar over the next few days, from a real freeBusy query.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Default 5." },
          maxSlots: { type: "number", description: "Default 10." },
        },
      },
    },
    handler: (ctx, input) =>
      checkCalendarAvailability(ctx, {
        days: input.days as number | undefined,
        maxSlots: input.maxSlots as number | undefined,
      }),
  },

  schedule_calendar_event: {
    schema: {
      name: "schedule_calendar_event",
      description:
        "Create a real event on the requester's own primary Google Calendar — a meeting, farmer site " +
        "visit, or VVB call. Externally visible the moment it is created (an attendee gets a real invite).",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          start: { type: "string", description: "ISO 8601 datetime." },
          end: { type: "string", description: "ISO 8601 datetime." },
          description: { type: "string" },
          attendeeEmail: { type: "string" },
        },
        required: ["summary", "start", "end"],
      },
    },
    handler: (ctx, input) =>
      scheduleCalendarEvent(ctx, {
        summary: String(input.summary ?? ""),
        start: String(input.start ?? ""),
        end: String(input.end ?? ""),
        description: input.description as string | undefined,
        attendeeEmail: input.attendeeEmail as string | undefined,
      }),
  },

  list_recent_mail: {
    schema: {
      name: "list_recent_mail",
      description: "Read-only: the requester's own recent inbox messages (sender, subject, snippet, date) — never sends or modifies anything.",
      inputSchema: {
        type: "object",
        properties: { maxResults: { type: "number", description: "Default 15." } },
      },
    },
    handler: (ctx, input) => listRecentMail(ctx, { maxResults: input.maxResults as number | undefined }),
  },

  run_pdd_generator_pipeline: {
    schema: {
      name: "run_pdd_generator_pipeline",
      description:
        "PDD GENERATOR: gated on the SEED questionnaire being fully answered. Runs precedent research " +
        "(local + live Verra registry), drafts every chapter, syncs the live PDD Google Doc, exports it as " +
        "PDF, emails it (defaults to nitzan@carbonature.io), records the run in Rebeka's memory, and locks " +
        "the SEED questionnaire. A fixed, deterministic sequence — not an autonomous loop.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          notifyEmail: { type: "string", description: "Defaults to the requester's own email." },
        },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) =>
      runPddGeneratorPipeline(ctx, {
        projectId: String(input.projectId ?? ""),
        notifyEmail: input.notifyEmail as string | undefined,
      }),
  },

  import_saas_project_farms: {
    schema: {
      name: "import_saas_project_farms",
      description:
        "Bring a real, already-onboarded project and its farms from the customer-facing SaaS database " +
        "into mrv (name, location, operator) — is_demo=false throughout. Creates the project row if it " +
        "doesn't exist yet. Does NOT import plots (quantification_approach must be decided first).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "e.g. 'CARBO-3988' — the mrv project id to create or add farms under." },
          projectName: { type: "string" },
          country: { type: "string" },
          methodology: { type: "string", description: "Defaults to 'VM0042 v2.2'." },
          creditingStart: { type: "string", description: "YYYY-MM-DD" },
          creditingEnd: { type: "string", description: "YYYY-MM-DD" },
          saasFarmIds: { type: "array", items: { type: "string" }, description: "public.farms.id values in the SaaS database." },
        },
        required: ["projectId", "projectName", "country", "saasFarmIds"],
      },
    },
    handler: (ctx, input) =>
      importSaasProjectFarms(ctx, {
        projectId: String(input.projectId ?? ""),
        projectName: String(input.projectName ?? ""),
        country: String(input.country ?? ""),
        methodology: input.methodology as string | undefined,
        creditingStart: input.creditingStart as string | undefined,
        creditingEnd: input.creditingEnd as string | undefined,
        saasFarmIds: (input.saasFarmIds as string[]) ?? [],
      }),
  },

  draft_pdd_chapter_content: {
    schema: {
      name: "draft_pdd_chapter_content",
      description:
        "Draft actual VM0042-precedent-style prose for a project's pending questionnaire sections within " +
        "given chapters (level-1 titles, e.g. 'Project Details'). Grounds each section in the founder's raw " +
        "direction (input_text), real project/farm facts, and indexed precedent excerpts. Writes to " +
        "drafted_text with status='drafted' — never 'answered', never overwrites a human-typed answer.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          chapterTitles: { type: "array", items: { type: "string" }, description: "Level-1 chapter titles from the registered template's own outline." },
        },
        required: ["projectId", "chapterTitles"],
      },
    },
    handler: (ctx, input) =>
      draftPddChapterContent(ctx, {
        projectId: String(input.projectId ?? ""),
        chapterTitles: (input.chapterTitles as string[]) ?? [],
      }),
  },

  download_related_pdds: {
    schema: {
      name: "download_related_pdds",
      description:
        "Download the real documents (PDD, listing representation, public comment summary, project boundary) for " +
        "given Verra project ids straight from Verra's public registry into a 'RELATED PDDS' subfolder under this " +
        "project's own Drive folder — real files, not links.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          verraProjectIds: { type: "array", items: { type: "string" }, description: "Verra registry project ids, e.g. '5325'." },
        },
        required: ["projectId", "verraProjectIds"],
      },
    },
    handler: (ctx, input) =>
      downloadRelatedPdds(ctx, {
        projectId: String(input.projectId ?? ""),
        verraProjectIds: (input.verraProjectIds as string[]) ?? [],
      }),
  },

  ingest_related_pdd_precedents: {
    schema: {
      name: "ingest_related_pdd_precedents",
      description:
        "Extract real text from the PDF/DOCX files already downloaded into this project's 'RELATED PDDS' Drive " +
        "folder and index it into the precedent corpus (mrv.pdd_precedents), so drafting can cite and be grounded " +
        "in them — content-addressed, so a second run only does the work for files that actually changed.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => ingestRelatedPddPrecedents(ctx, { projectId: String(input.projectId ?? "") }),
  },

  research_project_kickoff_date: {
    schema: {
      name: "research_project_kickoff_date",
      description:
        "Scan the project's own FARMERS Drive folder (one subfolder per client, each holding a Project Kick-off " +
        "Meeting report) for the earliest real kick-off meeting date across all clients, and record it as the " +
        "project's real activity start date (mrv.projects.project_start_date) — distinct from the crediting period " +
        "start, which is a separate, Verra-defined date.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => researchProjectKickoffDate(ctx, { projectId: String(input.projectId ?? "") }),
  },

  compile_eligibility_evidence_pack: {
    schema: {
      name: "compile_eligibility_evidence_pack",
      description:
        "Create (first call) or update (later calls) the Eligibility Evidence Pack — a Google Doc, in the " +
        "project's own Drive folder, linking every real recorded project activity (mrv.alm_activities) to " +
        "the specific VM0042 v2.2 Appendix 1 category and bullet it falls under, as supporting evidence for " +
        "eligibility (Applicability Condition 1) and additionality (Step 3 Common Practice). An activity type " +
        "with no Appendix 1 match is listed as needing a person's manual citation, never guessed at.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: (ctx, input) => compileEligibilityEvidencePack(ctx, { projectId: String(input.projectId ?? "") }),
  },

  update_pdd_seed_answer: {
    schema: {
      name: "update_pdd_seed_answer",
      description:
        "Save one answer in the flat SEED questionnaire (not tied to any PDD template section) — human-only, " +
        "same standing as update_pdd_section_status.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          questionKey: { type: "string" },
          answerText: { type: "string" },
        },
        required: ["projectId", "questionKey", "answerText"],
      },
    },
    handler: (ctx, input) =>
      updatePddSeedAnswer(ctx, {
        projectId: String(input.projectId ?? ""),
        questionKey: String(input.questionKey ?? ""),
        answerText: String(input.answerText ?? ""),
      }),
  },
};
