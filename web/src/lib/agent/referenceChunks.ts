// Pure module (no "server-only", no DB) so `node --test` can load it.
//
// Splits a long reference document — a methodology's Corrections & Clarifications, a program rule — into
// pieces an agent can later recall one at a time. A summary loses the exact wording ("Clarification 6 says …"),
// so these are the document's own text, cut at its natural joints.

export const MAX_CHUNK_CHARS = 3_000;
export const MAX_CHUNKS_PER_DOC = 80;
const WINDOW = 2_400;
const OVERLAP = 200;

// "1 CLARIFICATION 1" / "CORRECTION 3" on a line of its own — how Verra headlines each C&C item.
const ITEM_HEADING = /^[ \t]*(?:\d+[ \t]+)?(?:CLARIFICATION|CORRECTION)[ \t]+\d+[ \t]*$/gm;

function windows(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + WINDOW, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf("\n\n", end);
      if (para > i + WINDOW / 2) end = para;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out;
}

export function chunkReferenceText(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const heads = [...text.matchAll(ITEM_HEADING)].map((m) => m.index ?? 0);
  let parts: string[];
  if (heads.length >= 2) {
    // One chunk per numbered item; whatever precedes the first item (title, index table) is its own chunk(s).
    const bounds = [0, ...heads, text.length];
    parts = [];
    for (let k = 0; k < bounds.length - 1; k++) {
      const piece = text.slice(bounds[k], bounds[k + 1]).trim();
      if (piece) parts.push(piece);
    }
  } else {
    parts = [text];
  }

  const chunks: string[] = [];
  for (const p of parts) {
    if (p.length <= MAX_CHUNK_CHARS) chunks.push(p);
    else chunks.push(...windows(p));
  }
  return chunks.slice(0, MAX_CHUNKS_PER_DOC);
}
