import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface RecallAgentMemoryInput {
  query: string;
  projectId?: string | null;
  farmId?: string | null;
  kind?: string | null;
  /** Default 5, max 20. */
  limit?: number;
}

export interface RecalledMemory {
  memoryId: string;
  kind: string;
  content: string;
  projectId: string;
  farmId: string | null;
  createdBy: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
  /** Cosine distance — 0 is identical, larger is less similar. */
  distance: number;
}

/**
 * Semantic recall over mrv.agent_memory — the query is embedded once
 * (Voyage AI, the same model recordAgentMemory writes with) and
 * compared against every stored embedding by cosine distance (pgvector's
 * `<=>` operator, matching the HNSW index migration 0006 already built
 * for it). Optional projectId/farmId/kind filters narrow the search
 * without changing the ranking itself.
 */
export async function recallAgentMemory(
  ctx: ToolContext,
  input: RecallAgentMemoryInput,
): Promise<ToolResult<{ memories: RecalledMemory[] }>> {
  const guard = requireDbMode("recallAgentMemory");
  if (guard) return guard;

  const policy = await checkPolicy("recall_agent_memory", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.query?.trim()) return fail("recallAgentMemory: query is required.");
  if (input.limit != null && !(input.limit > 0)) return fail("recallAgentMemory: limit must be a positive number.");
  const limit = Math.min(input.limit ?? 5, 20);

  const { embedText, embeddingToSqlVector } = await import("../agent/voyageEmbeddings");
  let vector: string;
  try {
    vector = embeddingToSqlVector(await embedText(input.query.trim()));
  } catch (e) {
    return fail(`recallAgentMemory: could not compute an embedding — ${e instanceof Error ? e.message : String(e)}`);
  }

  const { query: dbQuery } = await import("../db");

  const rows = await dbQuery<{
    memory_id: string;
    kind: string;
    content: string;
    project_id: string;
    farm_id: string | null;
    created_by: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
    distance: string;
  }>(
    `SELECT memory_id, kind, content, project_id, farm_id, created_by, created_at, metadata,
            (embedding <=> $1::vector)::text AS distance
       FROM mrv.agent_memory
      WHERE embedding IS NOT NULL
        AND ($2::text IS NULL OR project_id = $2)
        AND ($3::uuid IS NULL OR farm_id = $3)
        AND ($4::text IS NULL OR kind = $4)
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $5`,
    [vector, input.projectId ?? null, input.farmId ?? null, input.kind ?? null, limit],
  );

  await audit(ctx, "recall_agent_memory", null, {
    projectId: input.projectId ?? null,
    farmId: input.farmId ?? null,
    kind: input.kind ?? null,
    resultsReturned: rows.length,
  });

  return ok({
    memories: rows.map((r) => ({
      memoryId: r.memory_id,
      kind: r.kind,
      content: r.content,
      projectId: r.project_id,
      farmId: r.farm_id,
      createdBy: r.created_by,
      createdAt: new Date(r.created_at).toISOString(),
      metadata: r.metadata ?? {},
      distance: Number(r.distance),
    })),
  });
}
