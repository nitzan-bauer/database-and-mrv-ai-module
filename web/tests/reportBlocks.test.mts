import test from "node:test";
import assert from "node:assert/strict";
import { inlineRuns, isRtl, parseReportBlocks } from "../src/lib/reports/reportBlocks.ts";

test("isRtl: mostly-Hebrew text is RTL, English with a Hebrew word is not", () => {
  assert.equal(isRtl("זהו סיכום של המחקר"), true);
  assert.equal(isRtl("The summary mentions one word: מחקר"), false);
  assert.equal(isRtl("12345 %"), false);
});

test("inlineRuns splits bold spans and leaves stray markers alone", () => {
  assert.deepEqual(inlineRuns("a **b** c"), [
    { text: "a ", bold: false },
    { text: "b", bold: true },
    { text: " c", bold: false },
  ]);
  assert.deepEqual(inlineRuns("2 ** 3"), [{ text: "2 ** 3", bold: false }]);
});

test("parseReportBlocks: headings, bullets, numbered lines and joined paragraph lines", () => {
  const blocks = parseReportBlocks("# Title\nfirst line\nsecond line\n\n- one\n* two\n1. step\n\n---\n\n#### deep");
  assert.deepEqual(blocks, [
    { kind: "heading", level: 1, text: "Title" },
    { kind: "paragraph", text: "first line second line" },
    { kind: "bullet", text: "one" },
    { kind: "bullet", text: "two" },
    { kind: "numbered", label: "1.", text: "step" },
    { kind: "heading", level: 3, text: "deep" },
  ]);
});

test("parseReportBlocks: pipe table drops the separator row", () => {
  const blocks = parseReportBlocks("| a | b |\n|---|:--:|\n| 1 | 2 |\n\nafter");
  assert.deepEqual(blocks, [
    { kind: "table", rows: [["a", "b"], ["1", "2"]] },
    { kind: "paragraph", text: "after" },
  ]);
});
