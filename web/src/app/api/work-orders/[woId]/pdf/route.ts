import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getWorkOrder } from "@/lib/data";
import { DEFAULT_GRACE_DAYS } from "@/lib/mcp/token";

/**
 * The printable work order (spec §6.5) — what actually reaches the sampling
 * contractor. Carries the header, the assignment block, the full sampling-
 * points table, the VM0042 §8.2.1.3 field protocol, and the MCP connection
 * block. Generated on demand so it always matches the current record.
 */

const PINE = rgb(0.17, 0.38, 0.38);
const INK = rgb(0.11, 0.17, 0.15);
const MUTED = rgb(0.36, 0.42, 0.4);
const LINE = rgb(0.89, 0.92, 0.91);

/**
 * The standard PDF fonts are WinAnsi-encoded, and pdf-lib drops anything
 * outside it silently — an em-dash vanishes rather than erroring, which is
 * exactly the kind of thing nobody notices until a contractor reads a gap in
 * the field. Map the typographic characters we actually use to ASCII.
 */
function wa(s: string): string {
  return s
    .replace(/[—–]/g, "-") // em/en dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ woId: string }> },
) {
  const { woId } = await params;
  const wo = await getWorkOrder(decodeURIComponent(woId));
  if (!wo) return new NextResponse("Work order not found", { status: 404 });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`CarboNature Work Order ${wo.woId}`);
  pdf.setAuthor("CarboNature");
  pdf.setSubject(`Soil sampling work order — ${wo.farmName}, cycle ${wo.cycleNumber}`);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const A4: [number, number] = [595.28, 841.89];
  const M = 46; // margin
  let page = pdf.addPage(A4);
  let y = A4[1] - M;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - M;
  };
  const need = (h: number) => {
    if (y - h < M) newPage();
  };
  const text = (
    s: string,
    x: number,
    size = 9,
    f = font,
    color = INK,
  ) => page.drawText(wa(s), { x, y, size, font: f, color });
  const rule = () => {
    page.drawLine({
      start: { x: M, y },
      end: { x: A4[0] - M, y },
      thickness: 0.7,
      color: LINE,
    });
  };

  /* ── header ─────────────────────────────────────────────── */
  text("CarboNature", M, 16, bold, PINE);
  text("VM0042 v2.2 · ICVCM CCP", A4[0] - M - 118, 8, mono, MUTED);
  y -= 20;
  text(`Soil Sampling Work Order · ${wo.woId}`, M, 13, bold, INK);
  y -= 14;
  text(
    `${wo.farmName} · Cycle ${wo.cycleNumber} · ${wo.approach} · ${wo.cycleType.replace("_", " ")}`,
    M,
    9,
    font,
    MUTED,
  );
  y -= 12;
  rule();
  y -= 18;

  /* ── assignment ─────────────────────────────────────────── */
  text("ASSIGNMENT", M, 8, bold, PINE);
  y -= 14;
  const rows: Array<[string, string]> = [
    ["Contractor", wo.contractorName ?? "— not assigned —"],
    ["Contact", wo.contractorEmail ?? "—"],
    ["Sampling window", `${wo.windowStart} to ${wo.windowEnd}`],
    [
      "Lab destination",
      wo.lab
        ? `${wo.lab.name}${wo.lab.iso17025 ? " · ISO 17025" : ""} · ${wo.lab.defaultMethod?.replace("_", " ") ?? ""}`
        : "— not assigned —",
    ],
    ["Project lead", wo.projectLead ?? "—"],
    ["Depth scheme", `${wo.depthScheme} cm (two increments, ESM basis)`],
    ["Points", `${wo.points.length} · min 5 composites per stratum`],
  ];
  for (const [k, v] of rows) {
    need(14);
    text(k, M, 9, font, MUTED);
    text(v, M + 105, 9, font, INK);
    y -= 13;
  }
  y -= 6;
  rule();
  y -= 18;

  /* ── points table ───────────────────────────────────────── */
  text(`SAMPLING POINTS (${wo.points.length})`, M, 8, bold, PINE);
  y -= 14;

  const cols = [M, M + 92, M + 118, M + 142, M + 208, M + 274, M + 330, M + 400];
  const head = ["Sample ID", "Str", "Sc", "Latitude", "Longitude", "Depth", "Cores", "Re-visit"];
  const drawHead = () => {
    head.forEach((h, i) => page.drawText(wa(h), { x: cols[i], y, size: 7.5, font: bold, color: MUTED }));
    y -= 4;
    rule();
    y -= 10;
  };
  drawHead();

  for (const p of wo.points) {
    if (y - 12 < M) {
      newPage();
      text(`SAMPLING POINTS (cont.)`, M, 8, bold, PINE);
      y -= 14;
      drawHead();
    }
    const cells = [
      p.sampleId,
      p.stratumCode ?? "-",
      p.scenario,
      p.lat.toFixed(5),
      p.lon.toFixed(5),
      p.depthScheme,
      String(p.compositeCores ?? "-"),
      p.isRevisit ? "yes" : "-",
    ];
    cells.forEach((c, i) =>
      page.drawText(wa(c), { x: cols[i], y, size: 7.5, font: i === 0 ? mono : font, color: INK }),
    );
    y -= 11;
  }

  y -= 8;
  need(150);
  rule();
  y -= 18;

  /* ── field protocol ─────────────────────────────────────── */
  text("FIELD PROTOCOL · VM0042 §8.2.1.3", M, 8, bold, PINE);
  y -= 14;
  const protocol = [
    "1. Clear the surface of litter and residue before coring; avoid wheel tracks and headlands.",
    `2. Take ${wo.points[0]?.compositeCores ?? 5} cores around each point and composite them into one sample`,
    `   per depth increment (${wo.depthScheme} cm).`,
    "3. Sieve to < 2 mm; retain and record coarse fragments — required for the ESM correction.",
    "4. Record the actual GPS position and photograph the labelled bag at every point.",
    "5. Ship to the laboratory within 5 days of collection; keep samples cool and dry in transit.",
  ];
  for (const l of protocol) {
    need(13);
    text(l, M, 8.5, font, INK);
    y -= 12;
  }
  y -= 8;
  need(110);
  rule();
  y -= 18;

  /* ── MCP block ──────────────────────────────────────────── */
  text("MCP ACTIVATION", M, 8, bold, PINE);
  y -= 14;
  if (wo.token) {
    text(`URL       sampler.carbonature.io/wo/${wo.woId}?token=<issued once>`, M, 8.5, mono, INK);
    y -= 12;
    text(`Expires   ${wo.token.expiresAt.slice(0, 10)}  (window end + ${DEFAULT_GRACE_DAYS} days)`, M, 8.5, mono, INK);
    y -= 12;
    text("Scope     this work order and its sampling points only", M, 8.5, mono, MUTED);
    y -= 12;
    text("Revocable by the Super Admin or Dave at any time.", M, 8.5, font, MUTED);
  } else {
    text("No token issued yet — minted when this work order is sent.", M, 8.5, font, MUTED);
    y -= 12;
    text(
      `It will expire ${DEFAULT_GRACE_DAYS} days after the window closes (${wo.windowEnd}).`,
      M,
      8.5,
      font,
      MUTED,
    );
  }

  /* ── footer on every page ───────────────────────────────── */
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(
      wa(`CarboNature · Work Order ${wo.woId} · ${wo.farmName} · page ${i + 1} of ${pages.length}`),
      { x: M, y: 24, size: 7, font: mono, color: MUTED },
    );
  });

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${wo.woId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
