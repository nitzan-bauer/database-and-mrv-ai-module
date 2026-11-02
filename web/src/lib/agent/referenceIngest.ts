import "server-only";
import type { ToolContext } from "../tools/context";
import { chunkReferenceText } from "./referenceChunks";

/**
 * Learn a reference document properly: store its own text, piece by piece, as long-term memory the agent can recall
 * later (kind 'protocol' — the one kind recall never ages out). The Drive digestion's 2-4 sentence note is a
 * summary; this is what lets an agent quote "Clarification 6" when it is writing the PDD.
 *
 * Idempotent per Drive file: a file already stored (same fileId) is skipped, so the scheduled digestion and a
 * manual ingest never double up. Embeddings are throttled and retried — Voyage rate-limits bursts.
 */

const GAP_MS = 1_200;
const RETRIES = 3;
const RETRY_WAIT_MS = 21_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface IngestResult {
  stored: number;
  failed: number;
  skipped: boolean;
  note: string;
}

export async function ingestReferenceDocument(
  ctx: ToolContext,
  input: {
    projectId: string;
    domain: string;
    fileId: string;
    fileName: string;
    text: string;
    /** Stop starting new chunks after this many ms — keeps a scheduled run inside its time budget. */
    deadlineMs?: number;
  },
): Promise<IngestResult> {
  const { query } = await import("../db");
  const { recordAgentMemory } = await import("../tools/recordAgentMemory");

  const have = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.agent_memory WHERE kind = 'protocol' AND metadata->>'fileId' = $1`,
    [input.fileId],
  );
  if (Number(have[0].n) > 0) return { stored: 0, failed: 0, skipped: true, note: `"${input.fileName}" already stored (${have[0].n} piece(s)).` };

  const chunks = chunkReferenceText(input.text);
  let stored = 0;
  let failed = 0;
  const started = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    if (input.deadlineMs && Date.now() - started > input.deadlineMs) {
      failed += chunks.length - i;
      break;
    }
    const content = `[${input.fileName} — part ${i + 1}/${chunks.length}]\n${chunks[i]}`;
    let ok = false;
    for (let attempt = 0; attempt <= RETRIES && !ok; attempt++) {
      const r = await recordAgentMemory(ctx, {
        projectId: input.projectId,
        kind: "protocol",
        domain: input.domain,
        content,
        metadata: { source: "reference_library", fileId: input.fileId, fileName: input.fileName, part: i + 1, parts: chunks.length },
      });
      if (r.ok) ok = true;
      else if (/\b429\b/.test(r.error) && attempt < RETRIES) await sleep(RETRY_WAIT_MS);
      else break;
    }
    if (ok) stored++;
    else failed++;
    await sleep(GAP_MS);
  }
  return {
    stored,
    failed,
    skipped: false,
    note: `"${input.fileName}": stored ${stored} of ${chunks.length} piece(s) as long-term reference${failed ? `, ${failed} failed` : ""}.`,
  };
}
