import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "dave_bsl_protocol_and_sampling_plan";

/**
 * Dave's first scheduled task (Stage 5 of the agent learning-layer plan,
 * Nitzan's own spec): research Verra's own public materials for baseline
 * (BSL) plot selection criteria, write it up as a real protocol, then use
 * it to build a real sampling plan — including baseline sampling — for
 * the two demo farms. Runs bimonthly; the schedule is expected to change
 * once real (non-demo) farms need this instead.
 *
 * Deliberately does NOT fabricate a baseline control site's geometry.
 * recordBaselineSite (Dave's own tool) measures area/distance from a real
 * geometry and refuses a fabricated-looking one no better than any other
 * tool in this codebase does — and there is no tool here that can
 * discover a real, on-the-ground candidate off-site parcel's coordinates.
 * That step stays a flagged follow-up for Nitzan, not a step this task
 * pretends to complete.
 */

const VERRA_RESEARCH_URLS = [
  "https://verra.org/methodologies/vm0042-methodology-for-improved-agricultural-land-management-v2-0/",
  "https://verra.org/wp-content/uploads/2023/09/VMD0053-Estimation-of-Baseline-Model-Validation-v1.0.pdf",
];

const PROTOCOL_SYSTEM_PROMPT =
  "You are Dave, CarboNature's Verification Manager AI agent. You've just read Verra's own public VM0042 " +
  "and VMD0053 materials. Write a real, usable field protocol document (400-700 words, plain prose, section " +
  "headers as short capitalized lines, no markdown tables) covering exactly two things: (1) the criteria for " +
  "selecting a valid baseline (BSL) control site per VM0042 Table 7 (similarity criteria, the 250 km distance " +
  "ceiling, the >=3 control sites requirement) — write only what the source material actually states, and mark " +
  "'[NEEDS: <specific gap>]' inline for anything the material doesn't cover rather than inventing it; (2) a " +
  "field protocol for the first sampling round (stratified random sampling per section 8.2.1.2 — depth scheme, " +
  "composite cores, minimum composites per stratum). This document will be re-read before every future BSL " +
  "selection and sampling round, so write it as a durable reference, not a one-off memo.";

async function runProtocolResearch(ctx: ToolContext): Promise<{ protocol: string | null; paragraphs: string[] }> {
  const { browseWebsite } = await import("../../tools/browseWebsite");
  const { getConfiguredProvider } = await import("../provider");
  const provider = await getConfiguredProvider();

  const pages: string[] = [];
  const readUrls: string[] = [];
  for (const url of VERRA_RESEARCH_URLS) {
    const res = await browseWebsite(ctx, { startUrl: url, maxPages: 3 });
    if (res.ok) {
      readUrls.push(...res.data.pages.map((p) => p.url));
      pages.push(...res.data.pages.map((p) => `[${p.title ?? p.url}] (${p.url})\n${p.textExcerpt}`));
    }
  }

  if (!pages.length) {
    return {
      protocol: null,
      paragraphs: ["Could not reach any of Verra's own research pages this run — no protocol written."],
    };
  }

  const resp = await provider.complete({
    system: PROTOCOL_SYSTEM_PROMPT,
    userMessage: `Source material:\n\n${pages.join("\n\n").slice(0, 12000)}`,
    tools: [],
    timeoutMs: 40_000,
    maxTokens: 4096,
  });
  const protocol = resp.kind === "text" ? resp.text.trim() : null;

  return {
    protocol,
    paragraphs: protocol
      ? [`Read ${readUrls.length} page(s) from Verra's own materials: ${readUrls.join(", ")}.`, "Protocol written and saved for reuse (see below)."]
      : ["Read Verra's materials but the model returned no protocol text this run."],
  };
}

async function runSamplingPlans(ctx: ToolContext): Promise<{ paragraphs: string[] }> {
  const { query } = await import("../../db");
  const { createSamplingPlan } = await import("../../tools/createSamplingPlan");

  const farms = await query<{ farm_id: string; name: string }>(
    `SELECT farm_id, name FROM mrv.farms WHERE name IN ('Elad Farm', 'Nitzan-Veg-Tech Farm')`,
  );
  if (!farms.length) {
    return { paragraphs: ["Neither demo farm (Elad Farm, Nitzan-Veg-Tech Farm) was found — no sampling plan created."] };
  }

  const paragraphs: string[] = [];
  for (const farm of farms) {
    const existing = await query<{ max: number | null }>(
      `SELECT max(cycle_number) AS max FROM mrv.sampling_cycles WHERE farm_id = $1`,
      [farm.farm_id],
    );
    const cycleNumber = (existing[0]?.max ?? 0) + 1;

    const result = await createSamplingPlan(ctx, { farmId: farm.farm_id, cycleNumber, approach: "QA2" });
    if (result.ok) {
      paragraphs.push(
        `${farm.name}: created sampling cycle ${cycleNumber} — ${result.data.totalPoints} points across ` +
          `${result.data.strata.length} stratum/strata (seed ${result.data.seed}, reproducible).`,
      );
    } else {
      paragraphs.push(`${farm.name}: could not create a sampling plan — ${result.error}`);
    }
  }

  paragraphs.push(
    "Baseline (BSL) control sites were NOT recorded automatically — that needs a real candidate off-site " +
      "location (coordinates), which no tool here can discover on its own. Once you have one, ask Dave to " +
      "record it against the protocol's criteria above.",
    "To send either sampling cycle to a contractor, ask Dave to propose the work order via chat — issuing one " +
      "requires your confirmation either way (it sends someone to a field), so this task doesn't attempt it.",
  );

  return { paragraphs };
}

export async function runDaveBslProtocolAndSamplingPlan(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const { recordAgentMemory } = await import("../../tools/recordAgentMemory");

  const research = await runProtocolResearch(ctx);
  const sampling = await runSamplingPlans(ctx);

  if (research.protocol) {
    await recordAgentMemory(ctx, {
      projectId: TARGET_PROJECT_ID,
      kind: "protocol",
      domain: "mrv",
      content: research.protocol,
      metadata: { actionName: TASK_KEY, agentId: "dave", title: "BSL selection & first sampling round protocol" },
    });
  }

  const bodyParagraphs = [...research.paragraphs, ...sampling.paragraphs];
  if (research.protocol) bodyParagraphs.push(`\n---\nPROTOCOL:\n\n${research.protocol}`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    agentId: "dave",
    domain: "mrv",
    subject: `BSL protocol & sampling plan — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs,
    memoryKind: "bsl_protocol_and_sampling_plan",
  });

  return { ok: outcome.ok && Boolean(research.protocol), detail: outcome.detail };
}
