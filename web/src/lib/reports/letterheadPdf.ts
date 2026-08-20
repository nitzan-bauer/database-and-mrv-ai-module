import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * A plain, branded report PDF — the letterhead half of every scheduled
 * task's "report on company letterhead, emailed to me" requirement
 * (Nitzan's own spec, live this session). Same visual pattern as
 * web/src/app/api/work-orders/[woId]/pdf/route.ts (PINE/INK/MUTED/LINE,
 * the wa() WinAnsi sanitizer) — a new, small module rather than a
 * refactor of that already-working route. Header/footer text comes from
 * the real mrv.org_profile row, the same source draftPddChapterContent.ts
 * already reads for the Project Proponent block — nothing here is invented.
 */

const PINE = rgb(0.17, 0.38, 0.38);
const INK = rgb(0.11, 0.17, 0.15);
const MUTED = rgb(0.36, 0.42, 0.4);
const LINE = rgb(0.89, 0.92, 0.91);

function wa(s: string): string {
  return s
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/…/g, "...")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->");
}

export interface LetterheadOrgProfile {
  legalName: string;
  address: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
}

/**
 * Wraps plain text to fit within `maxWidth` at `size` using `font`'s own
 * width table — no external layout library for a shape this simple.
 */
function wrapLines(font: import("pdf-lib").PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = wa(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * `title` + one paragraph per entry of `bodyParagraphs`, on CarboNature
 * letterhead. Returns raw PDF bytes ready for sendGmailMessage's
 * attachment param.
 */
export async function buildLetterheadPdf(input: {
  title: string;
  bodyParagraphs: string[];
  generatedAt: Date;
  org: LetterheadOrgProfile;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setAuthor("CarboNature MRV — Rebeka");
  pdf.setSubject(input.title);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const A4: [number, number] = [595.28, 841.89];
  const M = 56;
  const contentWidth = A4[0] - 2 * M;
  let page = pdf.addPage(A4);
  let y = A4[1] - M;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - M;
  };
  const need = (h: number) => {
    if (y - h < M + 30) newPage();
  };
  const text = (s: string, x: number, size = 9.5, f = font, color = INK) =>
    page.drawText(wa(s), { x, y, size, font: f, color });
  const rule = () =>
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.7, color: LINE });

  /* ── letterhead header ──────────────────────────────────── */
  text("CarboNature", M, 18, bold, PINE);
  text("VM0042 v2.2 · ICVCM CCP", A4[0] - M - 118, 8, mono, MUTED);
  y -= 24;
  text(input.org.legalName, M, 9, font, MUTED);
  y -= 12;
  for (const line of wrapLines(font, input.org.address, 8, contentWidth)) {
    text(line, M, 8, font, MUTED);
    y -= 10;
  }
  y -= 6;
  rule();
  y -= 24;

  /* ── title ──────────────────────────────────────────────── */
  text(input.title, M, 14, bold, INK);
  y -= 16;
  text(
    `Generated ${input.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    M,
    8,
    mono,
    MUTED,
  );
  y -= 20;

  /* ── body ───────────────────────────────────────────────── */
  for (const paragraph of input.bodyParagraphs) {
    for (const line of wrapLines(font, paragraph, 9.5, contentWidth)) {
      need(14);
      text(line, M, 9.5, font, INK);
      y -= 13;
    }
    y -= 8;
  }

  /* ── contact footer block ──────────────────────────────── */
  need(60);
  y -= 6;
  rule();
  y -= 16;
  text("Prepared by", M, 8, bold, PINE);
  y -= 12;
  text(`${input.org.contactName}, ${input.org.contactTitle}`, M, 8.5, font, INK);
  y -= 11;
  text(`${input.org.contactEmail} · ${input.org.contactPhone}`, M, 8.5, font, MUTED);

  /* ── page footer ────────────────────────────────────────── */
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(wa(`${input.org.legalName} · ${input.title} · page ${i + 1} of ${pages.length}`), {
      x: M,
      y: 24,
      size: 7,
      font: mono,
      color: MUTED,
    });
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
