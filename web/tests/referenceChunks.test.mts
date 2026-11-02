import test from "node:test";
import assert from "node:assert/strict";
import { chunkReferenceText, MAX_CHUNK_CHARS, MAX_CHUNKS_PER_DOC } from "../src/lib/agent/referenceChunks.ts";

test("a C&C document is cut at its numbered items, intro kept separately", () => {
  const doc = [
    "CORRECTIONS & CLARIFICATIONS\nindex table here",
    "1 CLARIFICATION 1\nThe first paragraph of Section 6 must be read as follows: baseline.",
    "2 CLARIFICATION 2\nTable 4 qualitative specifications clarified.",
    "3 CORRECTION 1\nThe unit for parameter VS has been corrected.",
  ].join("\n\n");
  const chunks = chunkReferenceText(doc);
  assert.equal(chunks.length, 4);
  assert.match(chunks[0], /index table/);
  assert.match(chunks[1], /^1 CLARIFICATION 1/);
  assert.match(chunks[3], /CORRECTION 1/);
  assert.equal(chunks.some((c) => /CLARIFICATION 2/.test(c) && /CORRECTION 1/.test(c)), false);
});

test("the mixed-case index rows ('Clarification 1 The baseline…') are not treated as headings", () => {
  const chunks = chunkReferenceText("Clarification 1 The baseline scenario…\nSection 6\nClarification 2 Table 4…");
  assert.equal(chunks.length, 1);
});

test("a long document with no item headings is windowed, every piece within the cap", () => {
  const para = "Sentence about the methodology. ".repeat(40).trim();
  const doc = Array.from({ length: 30 }, () => para).join("\n\n");
  const chunks = chunkReferenceText(doc);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.length <= MAX_CHUNK_CHARS));
});

test("the number of chunks per document is capped", () => {
  const doc = Array.from({ length: 400 }, (_, i) => `${i + 1} CLARIFICATION ${i + 1}\ntext ${i}`).join("\n\n");
  assert.equal(chunkReferenceText(doc).length, MAX_CHUNKS_PER_DOC);
});

test("empty input gives no chunks", () => {
  assert.deepEqual(chunkReferenceText("   \n "), []);
});
