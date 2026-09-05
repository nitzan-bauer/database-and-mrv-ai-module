import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_memory_consolidation";

/**
 * Stage 7 of the agent learning-layer plan: without this, near-duplicate
 * memories accumulate forever and dilute each other in semantic search
 * instead of reinforcing one idea — 20 almost-identical lessons on the
 * same real recurring issue compete in a recall's top-5 instead of one
 * sharp, consolidated one winning it. Runs monthly, working through a
 * bounded batch of near-duplicate pairs each time (deliberately
 * incremental rather than one big clustering pass — the same tables keep
 * growing between runs, so this converges over successive months instead
 * of needing to solve the whole backlog at once).
 *
 * Never deletes anything: the original rows get superseded_by set (0101)
 * and simply stop showing up in default recall (recallAgentMemory filters
 * WHERE superseded_by IS NULL) — the full history stays queryable.
 */
const MAX_MERGES_PER_RUN = 8;
/** Cosine distance ceiling for "these are near-duplicates," not just "related." Tight on purpose — a false merge loses real distinctions; a missed one just waits for next month. */
const DUPLICATE_DISTANCE_THRESHOLD = 0.08;

const MERGE_SYSTEM_PROMPT =
  "You are consolidating two near-duplicate memory entries recorded by CarboNature's MRV agents into one. " +
  "Write a single entry that keeps every distinct, concrete detail from both — do not drop information just " +
  "because it makes the result longer, and do not invent anything neither entry actually says. If the two " +
  "genuinely conflict on a fact, keep both statements and note the conflict explicitly rather than picking one " +
  "silently. 1-4 sentences. Output only the merged entry, nothing else.";

interface DuplicatePair {
  aId: string;
  bId: string;
  aContent: string;
  bContent: string;
  domain: string | null;
  kind: string;
  projectId: string;
  farmId: string | null;
}

async function findDuplicatePairs(): Promise<DuplicatePair[]> {
  const { query } = await import("../../db");
  const rows = await query<{
    a_id: string;
    b_id: string;
    a_content: string;
    b_content: string;
    domain: string | null;
    kind: string;
    project_id: string;
    farm_id: string | null;
  }>(
    `SELECT a.memory_id AS a_id, b.memory_id AS b_id, a.content AS a_content, b.content AS b_content,
            a.domain, a.kind, a.project_id, a.farm_id
       FROM mrv.agent_memory a
       JOIN mrv.agent_memory b
         ON b.memory_id > a.memory_id
        AND b.kind = a.kind
        AND (b.domain = a.domain OR (b.domain IS NULL AND a.domain IS NULL))
        AND b.project_id = a.project_id
        AND (a.embedding <=> b.embedding) < $1
      WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND a.superseded_by IS NULL AND b.superseded_by IS NULL
        AND a.kind IN ('lesson', 'finding', 'note')
      ORDER BY (a.embedding <=> b.embedding) ASC
      LIMIT $2`,
    [DUPLICATE_DISTANCE_THRESHOLD, MAX_MERGES_PER_RUN],
  );
  return rows.map((r) => ({
    aId: r.a_id,
    bId: r.b_id,
    aContent: r.a_content,
    bContent: r.b_content,
    domain: r.domain,
    kind: r.kind,
    projectId: r.project_id,
    farmId: r.farm_id,
  }));
}

export async function runJohnMemoryConsolidation(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { getConfiguredProvider } = await import("../provider");
  const { recordAgentMemory } = await import("../../tools/recordAgentMemory");
  const { query } = await import("../../db");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const pairs = await findDuplicatePairs();
  const paragraphs: string[] = [];
  let merged = 0;

  const provider = await getConfiguredProvider();
  for (const pair of pairs) {
    // A pair already consumed by an earlier merge in this same run (one of
    // its two ids already superseded) is skipped — re-checking live rather
    // than trusting the batch snapshot, since merges write as they go.
    const stillLive = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.agent_memory WHERE memory_id IN ($1, $2) AND superseded_by IS NULL`,
      [pair.aId, pair.bId],
    );
    if (Number(stillLive[0].n) !== 2) continue;

    let mergedText: string | null = null;
    try {
      const resp = await provider.complete({
        system: MERGE_SYSTEM_PROMPT,
        userMessage: `Entry A:\n${pair.aContent}\n\nEntry B:\n${pair.bContent}`,
        tools: [],
        maxTokens: 512,
      });
      mergedText = resp.kind === "text" ? resp.text.trim() : null;
    } catch {
      mergedText = null;
    }
    if (!mergedText) continue;

    const recorded = await recordAgentMemory(ctx, {
      projectId: pair.projectId,
      farmId: pair.farmId,
      kind: pair.kind,
      domain: pair.domain,
      content: mergedText,
      metadata: { mergedFrom: [pair.aId, pair.bId] },
    });
    if (!recorded.ok) continue;

    await query(`UPDATE mrv.agent_memory SET superseded_by = $1 WHERE memory_id IN ($2, $3)`, [
      recorded.data.memoryId,
      pair.aId,
      pair.bId,
    ]);
    merged++;
    paragraphs.push(`Merged 2 near-duplicate ${pair.kind} entries (domain: ${pair.domain ?? "none"}) into one.`);
  }

  if (!merged) paragraphs.unshift("No near-duplicate memories found this run — nothing to consolidate.");
  else paragraphs.unshift(`Consolidated ${merged} pair(s) of near-duplicate memories this run.`);

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    agentId: "john",
    domain: "mrv",
    subject: `Memory consolidation — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: paragraphs,
    memoryKind: "memory_consolidation",
    sendEmail: merged > 0,
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${merged} merge(s).)` };
}
