import "server-only";

/**
 * Voyage AI embeddings over plain `fetch` — the same choice made for
 * every other HTTP integration in this repo (anthropicProvider.ts,
 * driveClient.ts): one small, stable, well-documented endpoint does not
 * need an SDK dependency wrapped around it.
 *
 * voyage-3's default output is 1024 dimensions, which is what
 * mrv.agent_memory.embedding is declared as (migration 0040 — corrected
 * from an earlier, mismatched vector(1536) that assumed voyage-3
 * matched OpenAI's text-embedding-3-small; it never actually held a row).
 */
const VOYAGE_MODEL = "voyage-3";
export const EMBEDDING_DIM = 1024;

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set — run `npm run agent:key:voyage` in web/ to add it.");
  }

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ input: [text], model: VOYAGE_MODEL }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embeddings error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `Voyage returned an embedding of length ${embedding?.length ?? 0}, expected ${EMBEDDING_DIM}.`,
    );
  }
  return embedding;
}

/** pgvector's own literal syntax for a vector value. */
export function embeddingToSqlVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
