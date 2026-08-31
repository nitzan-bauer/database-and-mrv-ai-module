import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { Encodings } from "@pdf-lib/standard-fonts";

/**
 * A byte-for-byte-faithful reproduction of CarboNature's real letterhead
 * (Nitzan's own file, "CarboNature_Document_FIXED.docx" — the logo PNG,
 * watermark PNG, colors, and every line of footer text below are read
 * directly out of that document's header1.xml/footer1.xml/document.xml,
 * not approximated from memory: logo top-left over a solid #2B6161 rule,
 * a pale watermark centered on the page, and a footer (a #71BB93 rule,
 * then "CarboNature Strategies Ltd" / the real address / "KRA PIN: ...
 * · info@carbonature.io · www.carbonature.io") that matches the source
 * file's own text and colors exactly. Calibri (the source's own font)
 * isn't one of pdf-lib's built-in fonts and isn't legally embeddable
 * without a license — Helvetica, already used everywhere else this
 * codebase builds a PDF, is the closest standard substitute.
 */

const TEAL = rgb(0x2b / 255, 0x61 / 255, 0x61 / 255); // header rule + brand text — header1.xml/footer1.xml's own #2B6161
const SAGE = rgb(0x71 / 255, 0xbb / 255, 0x93 / 255); // footer's own top rule — #71BB93
const GRAY = rgb(0x6b / 255, 0x6b / 255, 0x6b / 255); // footer's own body text — #6B6B6B
const INK = rgb(0.11, 0.17, 0.15);

const ASSETS_DIR = path.join(process.cwd(), "src", "lib", "reports", "assets");
const LOGO_PATH = path.join(ASSETS_DIR, "carbonature-logo.png");
const WATERMARK_PATH = path.join(ASSETS_DIR, "carbonature-watermark.png");

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

/**
 * Report bodies now regularly carry real web-search text (John's market
 * scans, Rebeka's product research) rather than only this codebase's own
 * controlled strings — confirmed live: "tCO₂e" in a real search result
 * broke email delivery outright, `WinAnsi cannot encode "₂"` thrown deep
 * inside pdf-lib with no partial send. Subscript/superscript digits (CO₂,
 * m²) get a real substitution since they're common in this domain; a
 * final catch-all replaces anything else WinAnsi can't encode with "?"
 * rather than ever letting one stray character sink a whole report.
 *
 * That catch-all used to be a blanket `[^\x00-\xFF]` — codepoint > 255 —
 * which is NOT the same thing as "outside WinAnsi." WinAnsi (cp1252)
 * repurposes the 0x80-0x9F control-code gap for real printable characters
 * at codepoints > 0xFF: €(20AC), ™(2122), •(2022), Œ/œ(152/153),
 * Š/š(160/161), Ž/ž(17D/17E), and more. The old regex nuked every one of
 * these into "?", concretely turning real EUR prices in John's
 * market-scan reports into garbage. `canEncodeUnicodeCodePoint` is
 * pdf-lib's own WinAnsi table — asking it directly is the actual
 * contract, not the Latin-1 byte range this font encoding happens to
 * mostly overlap with.
 */
function wa(s: string): string {
  return s
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/…/g, "...")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => SUBSCRIPT_DIGITS[c])
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUPERSCRIPT_DIGITS[c])
    .replace(/[\s\S]/gu, (c) => (Encodings.WinAnsi.canEncodeUnicodeCodePoint(c.codePointAt(0)!) ? c : "?"));
}

export interface LetterheadOrgProfile {
  legalName: string;
  address: string;
  taxId: string;
}

export interface LetterheadTableColumn {
  header: string;
  width: number; // points, out of the page's contentWidth
  align?: "left" | "right";
}

export interface LetterheadTable {
  title?: string;
  /** A merged-cell-style row drawn above the column headers, grouping e.g. "Credit Buyers" over its VCU/USD sub-columns (Nitzan's own example, 2026-08-30 comments round). `span` counts columns starting from the running position — the group labels must cover every column left-to-right with no gaps. */
  groupHeaders?: { label: string; span: number }[];
  columns: LetterheadTableColumn[];
  rows: string[][];
  /** Row indexes (into `rows`) drawn bold on a shaded background — the "bottom line" a reader should catch in 3 seconds, per Nitzan's own request (2026-08-26): tables, not prose, with the summary row unmissable. */
  boldRowIndexes?: number[];
  /** Row indexes drawn as a blank visual gap — no text, no shading, no border — between one project's total and the next project's header (Nitzan, 2026-08-30). The row's own cell text is ignored; only its presence in `rows` matters for indexing. */
  spacerRowIndexes?: number[];
  /** Row indexes drawn in dark-green/bold/white — one step up from `boldRowIndexes`, reserved for the single grand-total row so it reads as more final than a per-project subtotal (Nitzan, 2026-08-30). */
  emphasisRowIndexes?: number[];
  /** Small-print lines rendered right after THIS table, before the next one — for working assumptions that belong under a specific table, not lumped with the report's opening paragraphs (Nitzan, 2026-08-30). */
  notes?: string[];
  /** Overrides the default 9pt data / 8.5pt header size — for a table with enough real columns (buyer name, transaction #, deal date, ...) that shrinking column widths further would start cutting real content rather than whitespace. Found live 2026-08-30: an 8-column Credit Buyers table had no width left to give without truncating something real. */
  fontSize?: number;
}

// A word that alone is wider than maxWidth (a long "Source: https://..."
// URL in John's market-scan reports is the real case that hits this) never
// fits no matter how empty `current` is — without this, the normal
// word-wrap loop below just lets it run off the page edge forever, since
// its only wrap point is "start a new line first," which doesn't help a
// single overlong token. Split it character-by-character into as many
// max-width chunks as it takes.
function forceBreakWord(font: PDFFont, word: string, size: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const ch of word) {
    const candidate = current + ch;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      chunks.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Single-line truncation with an ellipsis — for table cells, which never wrap (a wrapped cell would need per-row height variation this simple table drawer doesn't do). */
function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const clean = wa(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  const ellipsis = "...";
  let result = clean;
  while (result.length > 0 && font.widthOfTextAtSize(result + ellipsis, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + ellipsis;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = wa(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(w, size) > maxWidth) {
      const pieces = forceBreakWord(font, w, size, maxWidth);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    } else {
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface Segment {
  text: string;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
}

/** Draws several differently-styled runs as one centered line — the footer's "KRA PIN: X · email · website" mixes bold/plain and teal/gray on one line, the same way the source document's own footer does. */
function drawCenteredSegments(page: PDFPage, segments: Segment[], centerX: number, y: number): void {
  const totalWidth = segments.reduce((w, s) => w + s.font.widthOfTextAtSize(wa(s.text), s.size), 0);
  let x = centerX - totalWidth / 2;
  for (const s of segments) {
    page.drawText(wa(s.text), { x, y, size: s.size, font: s.font, color: s.color });
    x += s.font.widthOfTextAtSize(wa(s.text), s.size);
  }
}

/**
 * `title` + one paragraph per entry of `bodyParagraphs`, on CarboNature's
 * real letterhead. Returns raw PDF bytes ready for sendGmailMessage's
 * attachment param.
 */
export async function buildLetterheadPdf(input: {
  title: string;
  subtitle?: string;
  /** A small bold eyebrow label drawn directly above `bodyParagraphs` — e.g. "Summary" over the opening stat line (Nitzan's own example, 2026-08-30 comments round). */
  leadCaption?: string;
  bodyParagraphs: string[];
  /** Rendered after the paragraphs, as real bordered tables rather than wrapped prose — for reports where a reader needs the bottom line in a glance, not a paragraph to parse. */
  tables?: LetterheadTable[];
  generatedAt: Date;
  org: LetterheadOrgProfile;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setAuthor("CarboNature Strategies Ltd");
  pdf.setSubject(input.title);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await pdf.embedPng(fs.readFileSync(LOGO_PATH));
  const watermarkImage = await pdf.embedPng(fs.readFileSync(WATERMARK_PATH));

  const A4: [number, number] = [595.28, 841.89]; // matches the source file's own pgSz (11906 x 16838 twips)
  const M = 56.7; // ~1in, matches the source file's own left/right pgMar (1440 twips)
  const contentWidth = A4[0] - 2 * M;
  const FOOTER_H = 70; // room reserved above the bottom margin for the 3-line footer + its rule

  const logoWidth = 130;
  const logoHeight = logoWidth * (logoImage.height / logoImage.width);
  const watermarkWidth = A4[0] * 0.62;
  const watermarkHeight = watermarkWidth * (watermarkImage.height / watermarkImage.width);

  let page!: PDFPage;
  let y!: number;

  const drawChrome = () => {
    // Watermark first, centered on the page, behind everything — the
    // source file's own image is already pale (near-white), so no extra
    // PDF-level opacity trick is needed to keep it a watermark, not a background.
    page.drawImage(watermarkImage, {
      x: (A4[0] - watermarkWidth) / 2,
      y: (A4[1] - watermarkHeight) / 2,
      width: watermarkWidth,
      height: watermarkHeight,
    });

    // Header: logo top-left over a solid teal rule (header1.xml).
    const logoY = A4[1] - M + 8;
    page.drawImage(logoImage, { x: M, y: logoY - logoHeight, width: logoWidth, height: logoHeight });
    page.drawLine({
      start: { x: M, y: logoY - logoHeight - 8 },
      end: { x: A4[0] - M, y: logoY - logoHeight - 8 },
      thickness: 1.75,
      color: TEAL,
    });

    // Footer: a sage rule, then the source file's own three lines, verbatim.
    const fy = M - 8;
    page.drawLine({ start: { x: M, y: fy }, end: { x: A4[0] - M, y: fy }, thickness: 0.75, color: SAGE });
    const centerX = A4[0] / 2;
    drawCenteredSegments(page, [{ text: `${input.org.legalName}`, font: bold, size: 8.5, color: TEAL }], centerX, fy - 14);
    drawCenteredSegments(page, [{ text: input.org.address, font, size: 7.5, color: GRAY }], centerX, fy - 25);
    drawCenteredSegments(
      page,
      [
        { text: `KRA PIN: ${input.org.taxId}`, font: bold, size: 7.5, color: TEAL },
        { text: "   •   info@carbonature.io   •   ", font, size: 7.5, color: GRAY },
        { text: "www.carbonature.io", font, size: 7.5, color: TEAL },
      ],
      centerX,
      fy - 36,
    );
  };

  const newPage = () => {
    page = pdf.addPage(A4);
    drawChrome();
    y = A4[1] - M - logoHeight - 30;
  };

  const need = (h: number) => {
    if (y - h < M + FOOTER_H) newPage();
  };

  newPage();

  /* ── title block (document.xml's own [DOCUMENT TITLE]/[Subtitle]/[Date] convention) ── */
  const centerX = A4[0] / 2;
  const titleLines = wrapLines(bold, input.title, 17, contentWidth);
  for (const line of titleLines) {
    const w = bold.widthOfTextAtSize(line, 17);
    page!.drawText(line, { x: centerX - w / 2, y, size: 17, font: bold, color: TEAL });
    y -= 21;
  }
  y -= 3;
  if (input.subtitle) {
    const w = font.widthOfTextAtSize(input.subtitle, 11);
    page!.drawText(input.subtitle, { x: centerX - w / 2, y, size: 11, font, color: GRAY });
    y -= 16;
  }
  const dateLine = `Date: ${input.generatedAt.toLocaleDateString("en-GB")}`;
  const dw = font.widthOfTextAtSize(dateLine, 10);
  page!.drawText(dateLine, { x: centerX - dw / 2, y, size: 10, font, color: GRAY });
  y -= 26;

  /* ── body ───────────────────────────────────────────────── */
  if (input.leadCaption) {
    need(14);
    page!.drawText(wa(input.leadCaption.toUpperCase()), { x: M, y, size: 8.5, font: bold, color: TEAL });
    y -= 13;
  }
  for (const paragraph of input.bodyParagraphs) {
    for (const line of wrapLines(font, paragraph, 9.5, contentWidth)) {
      need(14);
      page!.drawText(wa(line), { x: M, y, size: 9.5, font, color: INK });
      y -= 13;
    }
    y -= 8;
  }

  /* ── tables ─────────────────────────────────────────────── */
  const HEADER_BG = rgb(0x2b / 255, 0x61 / 255, 0x61 / 255); // TEAL
  const GROUP_BG = rgb(0x71 / 255, 0xbb / 255, 0x93 / 255); // SAGE — one shade lighter than the header, for the merged group-label row above it
  const BOLD_ROW_BG = rgb(0xe3 / 255, 0xed / 255, 0xe9 / 255); // pale sage — matches the spec artifacts' own --accent-soft
  const EMPHASIS_BG = rgb(0x16 / 255, 0x3d / 255, 0x2e / 255); // dark green — the grand-total row, one step past a per-project subtotal
  const ROW_H = 16;
  const SPACER_H = 8;
  const PAD = 4;
  const BORDER = rgb(0x2b / 255, 0x61 / 255, 0x61 / 255);

  for (const table of input.tables ?? []) {
    // Keep the whole table together on one page rather than splitting mid-
    // table with no repeated header on the continuation (Nitzan, 2026-08-31).
    // A table taller than a full page still has to spill — the row-level
    // `need()` calls below remain as that fallback — but the common case
    // (every Book table today) now always starts fresh rather than
    // gambling on whatever room is left on the current page.
    const rowsHeight = (table.rows ?? []).reduce((h, _row, i) => h + ((table.spacerRowIndexes ?? []).includes(i) ? SPACER_H : ROW_H), 0);
    const estimatedHeight =
      (table.title ? 20 : 0) + (table.groupHeaders?.length ? ROW_H + 4 : 0) + (ROW_H + 4) + rowsHeight + 14;
    need(estimatedHeight);

    if (table.title) {
      need(20);
      page!.drawText(wa(table.title), { x: M, y, size: 11, font: bold, color: TEAL });
      y -= 16;
    }

    const totalColsWidth = table.columns.reduce((w, c) => w + c.width, 0);
    const scale = contentWidth / totalColsWidth; // columns are authored relative to a nominal width; scale to fit the real content width
    const colWidths = table.columns.map((c) => c.width * scale);
    const colX: number[] = [];
    let cx = M;
    for (const w of colWidths) {
      colX.push(cx);
      cx += w;
    }

    const tableTop = y;
    const framePage = page; // if a row-loop page break moves `page` on, tableTop/y stop being the same coordinate space — the frame below must not draw across that gap (see the guard where it's used)

    // A table with enough real columns (buyer name, transaction #, deal
    // date, ...) can run out of width to give without cutting real content
    // rather than whitespace — `fontSize` shrinks everything in this table
    // together rather than fighting column widths past the point where
    // there's nothing left to reclaim (found live 2026-08-30).
    const dataSize = table.fontSize ?? 9;
    const headerSize = dataSize - 0.5;
    const groupSize = dataSize - 1;

    // Group-header row — merged-looking labels (e.g. "Credit Buyers" spanning its VCU/USD sub-columns) drawn above the real column headers.
    if (table.groupHeaders?.length) {
      need(ROW_H + 4);
      let gi = 0;
      for (const group of table.groupHeaders) {
        const gx = colX[gi];
        const gw = colWidths.slice(gi, gi + group.span).reduce((w, x) => w + x, 0);
        page!.drawRectangle({ x: gx, y: y - ROW_H + 4, width: gw, height: ROW_H, color: GROUP_BG });
        if (group.label) {
          const cellText = truncateToWidth(bold, group.label, groupSize, gw - 2 * PAD);
          const textW = bold.widthOfTextAtSize(cellText, groupSize);
          page!.drawText(cellText, { x: gx + gw / 2 - textW / 2, y: y - ROW_H + 4 + 5, size: groupSize, font: bold, color: rgb(1, 1, 1) });
        }
        page!.drawLine({ start: { x: gx, y: y - ROW_H + 4 }, end: { x: gx, y }, thickness: 0.75, color: rgb(1, 1, 1) });
        gi += group.span;
      }
      y -= ROW_H;
    }

    const subHeaderTop = y; // fine column-divider lines start here, not at tableTop — a group-header row's own dividers (drawn above, at group boundaries only) must not be crossed by every sub-column's divider

    // Header row.
    need(ROW_H + 4);
    page!.drawRectangle({ x: M, y: y - ROW_H + 4, width: contentWidth, height: ROW_H, color: HEADER_BG });
    table.columns.forEach((col, i) => {
      const cellText = truncateToWidth(bold, col.header, headerSize, colWidths[i] - 2 * PAD);
      const textW = bold.widthOfTextAtSize(cellText, headerSize);
      const tx = col.align === "right" ? colX[i] + colWidths[i] - PAD - textW : colX[i] + PAD;
      page!.drawText(cellText, { x: tx, y: y - ROW_H + 4 + 5, size: headerSize, font: bold, color: rgb(1, 1, 1) });
    });
    y -= ROW_H;

    // Data rows — a bold row (a project subtotal) gets a shaded background; an emphasis row (the grand total) gets a stronger dark-green one; a spacer row is a blank visual gap.
    const boldSet = new Set(table.boldRowIndexes ?? []);
    const spacerSet = new Set(table.spacerRowIndexes ?? []);
    const emphasisSet = new Set(table.emphasisRowIndexes ?? []);
    table.rows.forEach((row, rowIndex) => {
      if (spacerSet.has(rowIndex)) {
        need(SPACER_H);
        y -= SPACER_H;
        return;
      }
      need(ROW_H);
      const isEmphasis = emphasisSet.has(rowIndex);
      const isBold = isEmphasis || boldSet.has(rowIndex);
      if (isEmphasis) page!.drawRectangle({ x: M, y: y - ROW_H + 4, width: contentWidth, height: ROW_H, color: EMPHASIS_BG });
      else if (isBold) page!.drawRectangle({ x: M, y: y - ROW_H + 4, width: contentWidth, height: ROW_H, color: BOLD_ROW_BG });
      const rowFont = isBold ? bold : font;
      const rowColor = isEmphasis ? rgb(1, 1, 1) : INK;
      row.forEach((cell, i) => {
        const cellText = truncateToWidth(rowFont, cell, dataSize, (colWidths[i] ?? 0) - 2 * PAD);
        const textW = rowFont.widthOfTextAtSize(cellText, dataSize);
        const tx = table.columns[i]?.align === "right" ? colX[i] + colWidths[i] - PAD - textW : colX[i] + PAD;
        page!.drawText(cellText, { x: tx, y: y - ROW_H + 4 + 5, size: dataSize, font: rowFont, color: rowColor });
      });
      page!.drawLine({
        start: { x: M, y: y - ROW_H + 4 },
        end: { x: M + contentWidth, y: y - ROW_H + 4 },
        thickness: isEmphasis ? 1 : 0.5,
        color: isEmphasis ? EMPHASIS_BG : rgb(0.8, 0.83, 0.81),
      });
      y -= ROW_H;
    });

    // Outer frame + column dividers around the whole table (header + group-header down through the last data row) — the border weight/emphasis Nitzan asked for (2026-08-26).
    // Only when the table stayed on ONE page: `tableTop` and `y` are only
    // the same coordinate space if no row-loop page break moved `page` on
    // in between. A table that broke across a page (a real case found live
    // 2026-08-30 — the area table's footnotes pushed its own GRAND TOTAL
    // row onto page 2) would otherwise draw a frame mixing page-1's top
    // with page-2's bottom — a huge, meaningless box. Skipping the
    // decorative frame in that rare case is a safe fallback; every row
    // still has its own per-row bottom border regardless (drawn above,
    // page-local at draw time, unaffected by this).
    if (page === framePage) {
      // pdf-lib centers a rectangle's stroke ON its path — an un-offset frame
      // at exactly [tableTop, y+4] puts half that stroke INSIDE the table,
      // visibly bleeding into the group-header row's own background
      // (confirmed against Nitzan's own screenshot, 2026-08-30). Pushing the
      // frame outward by half the stroke width on every side keeps the ink
      // fully outside the content it's framing.
      const FRAME_W = 1.25;
      page!.drawRectangle({
        x: M - FRAME_W / 2,
        y: y + 4 - FRAME_W / 2,
        width: contentWidth + FRAME_W,
        height: tableTop - y - 4 + FRAME_W,
        borderColor: BORDER,
        borderWidth: FRAME_W,
      });
      for (let i = 1; i < colX.length; i++) {
        page!.drawLine({ start: { x: colX[i], y: y + 4 }, end: { x: colX[i], y: subHeaderTop }, thickness: 0.5, color: rgb(0.8, 0.83, 0.81) });
      }
    }

    y -= 14;

    // Small-print notes for THIS table — positioned here, not lumped with the opening paragraphs, with a little breathing room between each one.
    for (const note of table.notes ?? []) {
      for (const line of wrapLines(font, note, 8, contentWidth)) {
        need(12);
        page!.drawText(wa(line), { x: M, y, size: 8, font, color: GRAY });
        y -= 11;
      }
      y -= 4;
    }
    if (table.notes?.length) y -= 6;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
