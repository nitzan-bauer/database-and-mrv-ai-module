import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { inlineRuns, isRtl, parseReportBlocks, type ReportBlock } from "./reportBlocks";

/**
 * The same CarboNature letterhead as letterheadPdf.ts (logo over a #2B6161 rule, a #71BB93 footer rule, the real
 * org lines), as an editable Word document. Unlike the PDF it is not limited to WinAnsi, so Hebrew prints in full:
 * a paragraph that is mostly Hebrew is laid out right-to-left.
 */

const TEAL = "2B6161";
const SAGE = "71BB93";
const GRAY = "6B6B6B";
const INK = "1C2B26";
const FONT = "Calibri";

const LOGO_PATH = path.join(process.cwd(), "src", "lib", "reports", "assets", "carbonature-logo.png");

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function runs(text: string, rtl: boolean, base: { size?: number; color?: string; bold?: boolean } = {}): TextRun[] {
  return inlineRuns(text).map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || base.bold,
        size: base.size ?? 22,
        color: base.color ?? INK,
        font: FONT,
        rightToLeft: rtl,
      }),
  );
}

function para(text: string, opts: { size?: number; color?: string; bold?: boolean; after?: number; before?: number; indent?: number } = {}): Paragraph {
  const rtl = isRtl(text);
  return new Paragraph({
    bidirectional: rtl,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: 288 },
    indent: opts.indent ? { left: opts.indent, hanging: 0 } : undefined,
    children: runs(text, rtl, opts),
  });
}

function blockToChildren(b: ReportBlock): (Paragraph | Table)[] {
  switch (b.kind) {
    case "heading": {
      const size = b.level === 1 ? 30 : b.level === 2 ? 26 : 23;
      return [para(b.text, { size, bold: true, color: TEAL, before: b.level === 1 ? 280 : 200, after: 100 })];
    }
    case "bullet": {
      const rtl = isRtl(b.text);
      return [
        new Paragraph({
          bidirectional: rtl,
          spacing: { after: 80, line: 288 },
          indent: { left: 360, hanging: 240 },
          children: [new TextRun({ text: "•  ", font: FONT, size: 22, color: TEAL, rightToLeft: rtl }), ...runs(b.text, rtl)],
        }),
      ];
    }
    case "numbered": {
      const rtl = isRtl(b.text);
      return [
        new Paragraph({
          bidirectional: rtl,
          spacing: { after: 80, line: 288 },
          indent: { left: 400, hanging: 320 },
          children: [new TextRun({ text: `${b.label}  `, font: FONT, size: 22, color: TEAL, bold: true, rightToLeft: rtl }), ...runs(b.text, rtl)],
        }),
      ];
    }
    case "table": {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const total = 9400; // A4 text width in DXA
      const w = Math.floor(total / cols);
      const rtl = b.rows.some((r) => r.some((c) => isRtl(c)));
      const border = { style: BorderStyle.SINGLE, size: 4, color: "C9D6D1" };
      const borders = { top: border, bottom: border, left: border, right: border };
      return [
        new Table({
          width: { size: w * cols, type: WidthType.DXA },
          columnWidths: Array(cols).fill(w),
          visuallyRightToLeft: rtl,
          rows: b.rows.map(
            (row, ri) =>
              new TableRow({
                tableHeader: ri === 0,
                children: Array.from({ length: cols }, (_, ci) => {
                  const text = row[ci] ?? "";
                  const cellRtl = rtl || isRtl(text); // in a right-to-left table, numbers align right too
                  return new TableCell({
                    width: { size: w, type: WidthType.DXA },
                    borders,
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                    shading: ri === 0 ? { fill: "E6F1EC", type: "clear" as never, color: "auto" } : undefined,
                    children: [
                      new Paragraph({
                        bidirectional: cellRtl,
                        spacing: { after: 0 },
                        children: runs(text, cellRtl, { size: 20, bold: ri === 0 }),
                      }),
                    ],
                  });
                }),
              }),
          ),
        }),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
      ];
    }
    default:
      return [para(b.text)];
  }
}

export async function buildLetterheadDocx(input: {
  title: string;
  subtitle: string;
  /** Markdown-ish body — headings, bullets, numbered lines, **bold**, pipe tables. */
  body: string;
  generatedAt: Date;
  org: { legalName: string; address: string; taxId: string };
}): Promise<Buffer> {
  const logo = fs.readFileSync(LOGO_PATH);
  const { width, height } = pngSize(logo);
  const logoW = 150;
  const logoH = Math.round((logoW * height) / width);

  const titleRtl = isRtl(input.title);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      bidirectional: titleRtl,
      spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: input.title, bold: true, size: 36, color: TEAL, font: FONT, rightToLeft: titleRtl })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: SAGE, space: 6 } },
      children: [
        new TextRun({
          text: `${input.subtitle}  ·  ${input.generatedAt.toISOString().slice(0, 10)}`,
          size: 18,
          color: GRAY,
          font: FONT,
        }),
      ],
    }),
    ...parseReportBlocks(input.body).flatMap(blockToChildren),
  ];

  const footerLine = (text: string, opts: { bold?: boolean; color?: string } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 },
      children: [new TextRun({ text, size: 15, font: FONT, color: opts.color ?? GRAY, bold: opts.bold })],
    });

  const doc = new Document({
    creator: "CarboNature Strategies Ltd",
    title: input.title,
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1700, bottom: 1500, left: 1253, right: 1253 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                spacing: { after: 0 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 6 } },
                children: [new ImageRun({ type: "png", data: logo, transformation: { width: logoW, height: logoH } })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 40 },
                border: { top: { style: BorderStyle.SINGLE, size: 6, color: SAGE, space: 6 } },
                children: [new TextRun({ text: input.org.legalName, size: 16, bold: true, color: TEAL, font: FONT })],
              }),
              footerLine(input.org.address),
              footerLine(`KRA PIN: ${input.org.taxId} · info@carbonature.io · www.carbonature.io`),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
