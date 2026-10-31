/**
 * Turns an agent's answer (light Markdown: #-headings, bullets, numbered lines, **bold**, pipe tables) into plain
 * blocks that letterheadDocx.ts lays out. Pure and dependency-free so it can be unit-tested.
 */

export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "numbered"; label: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] };

export interface InlineRun {
  text: string;
  bold: boolean;
}

const HEBREW = /[֐-׿]/g;
const LETTERS = /[A-Za-z֐-׿]/g;

/** A paragraph is right-to-left when most of its letters are Hebrew. */
export function isRtl(text: string): boolean {
  const hebrew = (text.match(HEBREW) ?? []).length;
  const letters = (text.match(LETTERS) ?? []).length;
  return letters > 0 && hebrew / letters > 0.5;
}

/** Splits **bold** spans; unmatched markers are left as plain text. */
export function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) runs.push({ text: p.slice(2, -2), bold: true });
    else runs.push({ text: p, bold: false });
  }
  return runs;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseReportBlocks(markdown: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let table: string[][] | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ").trim() });
    para = [];
  };
  const flushTable = () => {
    if (table && table.length) blocks.push({ kind: "table", rows: table });
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.indexOf("|", 1) > 0) {
      flushPara();
      if (/^\|?[\s:|-]+\|?$/.test(trimmed) && trimmed.includes("-")) continue; // the |---|---| separator row
      (table ??= []).push(splitRow(trimmed));
      continue;
    }
    flushTable();

    if (!trimmed) {
      flushPara();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      blocks.push({ kind: "heading", level: Math.min(heading[1].length, 3) as 1 | 2 | 3, text: heading[2].replace(/\*\*/g, "").trim() });
      continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushPara();
      blocks.push({ kind: "bullet", text: bullet[1] });
      continue;
    }
    const numbered = trimmed.match(/^(\d{1,3}[.)])\s+(.*)$/);
    if (numbered) {
      flushPara();
      blocks.push({ kind: "numbered", label: numbered[1], text: numbered[2] });
      continue;
    }
    if (/^[-_*]{3,}$/.test(trimmed)) {
      flushPara();
      continue; // horizontal rule
    }
    para.push(trimmed);
  }
  flushPara();
  flushTable();
  return blocks;
}
