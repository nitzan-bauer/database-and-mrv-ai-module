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
  bodyParagraphs: string[];
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
  for (const paragraph of input.bodyParagraphs) {
    for (const line of wrapLines(font, paragraph, 9.5, contentWidth)) {
      need(14);
      page!.drawText(wa(line), { x: M, y, size: 9.5, font, color: INK });
      y -= 13;
    }
    y -= 8;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
