import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface AgentMemoryInput {
  projectId: string;
  content: string;
  farmId?: string | null;
  /** Free text, e.g. 'note' | 'finding' | 'decision'. Defaults to 'long_term'. */
  kind?: string;
  metadata?: Record<string, unknown> | null;
}

export interface RecordedAgentMemory {
  memoryId: string;
}

/**
 * Write one entry to mrv.agent_memory with a real Voyage AI embedding —
 * not a scoped-per-agent log (the table carries no agent_id column,
 * only project_id/farm_id/created_by), so any agent's own findings are
 * recallable by any other agent working the same project or farm.
 *
 * The embedding is computed here, once, at write time — recallAgentMemory
 * only ever embeds the query side, never re-embeds stored content.
 */
export async function recordAgentMemory(
  ctx: ToolContext,
  input: AgentMemoryInput,
): Promise<ToolResult<RecordedAgentMemory>> {
  const guard = requireDbMode("recordAgentMemory");
  if (guard) return guard;

  const policy = await checkPolicy("record_agent_memory", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.content?.trim()) return fail("recordAgentMemory: content is required.");
  const kind = input.kind?.trim() || "long_term";

  const { embedText, embeddingToSqlVector } = await import("../agent/voyageEmbeddings");
  let vector: string;
  try {
    vector = embeddingToSqlVector(await embedText(input.content.trim()));
  } catch (e) {
    return fail(`recordAgentMemory: could not compute an embedding — ${e instanceof Error ? e.message : String(e)}`);
  }

  const { query } = await import("../db");

  const projects = await query<{ n: string }>(`SELECT count(*)::text n FROM mrv.projects WHERE project_id = $1`, [
    input.projectId,
  ]);
  if (Number(projects[0].n) === 0) return fail("recordAgentMemory: no such project.");

  const rows = await query<{ memory_id: string }>(
    `INSERT INTO mrv.agent_memory (project_id, farm_id, kind, content, embedding, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, $7)
     RETURNING memory_id`,
    [
      input.projectId,
      input.farmId ?? null,
      kind,
      input.content.trim(),
      vector,
      JSON.stringify(input.metadata ?? {}),
      ctx.actor,
    ],
  );
  const memoryId = rows[0].memory_id;

  await audit(ctx, "record_agent_memory", { type: "agent_memory", id: memoryId }, {
    projectId: input.projectId,
    farmId: input.farmId ?? null,
    kind,
  });

  return ok({ memoryId });
}
