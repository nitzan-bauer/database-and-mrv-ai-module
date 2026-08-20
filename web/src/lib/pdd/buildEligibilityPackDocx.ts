import "server-only";
import { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, Packer } from "docx";
import type { EligibilityActivityGroup } from "../tools/compileEligibilityEvidencePack";
import { VM0042_DEFINITIONS_CITATION } from "./vm0042EligibilityReference";

const MATCHED_COLOR = "75BB94"; // sage-400 — same "confirmed" green the Readiness Report uses
const UNMATCHED_COLOR = "D4B46A"; // gold-400 — same "needs attention" tone as its "drafted" segments

function header(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] });
}

function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ text })] });
}

function activityTable(groups: EligibilityActivityGroup[]): Table {
  const headerRow = new TableRow({
    children: [
      header("Activity"),
      header("Farms / Plots / Applications"),
      header("VM0042 Appendix 1 category"),
      header("Matched bullet"),
      header("Citation"),
    ],
  });
  const body = groups.map((g) => {
    const label = g.activityLabel ? `${g.activityLabel} (${g.activityType})` : g.activityType;
    const scope = `${g.farmCount} farm${g.farmCount === 1 ? "" : "s"} · ${g.plotCount} plot${g.plotCount === 1 ? "" : "s"} · ${g.applications} application${g.applications === 1 ? "" : "s"}`;
    return new TableRow({
      children: [
        new TableCell({
          shading: { fill: g.matched ? MATCHED_COLOR : UNMATCHED_COLOR },
          children: [new Paragraph({ text: label })],
        }),
        cell(scope),
        cell(g.category ?? "Not covered by Appendix 1's non-exhaustive list — needs a person to identify the closest practice or argue a new one."),
        cell(g.bullet ?? "—"),
        cell(g.citation ?? "—"),
      ],
    });
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...body] });
}

export async function buildEligibilityPackDocx(projectName: string, groups: EligibilityActivityGroup[]): Promise<Buffer> {
  const unmatched = groups.filter((g) => !g.matched);

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `Eligibility Evidence Pack — ${projectName}`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [new TextRun({ text: `Generated ${new Date().toISOString()}`, italics: true })],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      text:
        "Every real, recorded project activity, linked to the specific VM0042 v2.2 Appendix 1 category and " +
        "bullet it falls under — supporting evidence for Applicability Condition 1 (eligibility) and Step 3 " +
        "Common Practice (additionality), the purpose Appendix 1 itself states for this list.",
    }),
    new Paragraph({ text: "" }),
  ];

  if (!groups.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "No project activities are recorded yet (mrv.alm_activities) — nothing to link.", italics: true })],
      }),
    );
  } else {
    children.push(activityTable(groups));
  }

  children.push(new Paragraph({ text: "" }));

  if (unmatched.length) {
    children.push(new Paragraph({ text: "Needs a manual citation", heading: HeadingLevel.HEADING_2 }));
    children.push(
      new Paragraph({
        text:
          `${unmatched.map((g) => g.activityLabel ?? g.activityType).join(", ")} — Appendix 1 (p.140-142) is explicitly ` +
          "non-exhaustive; identify the closest listed practice this activity improves on, or document it as a distinct, " +
          "emerging practice per the methodology's own instruction (p.140).",
      }),
    );
    children.push(new Paragraph({ text: "" }));
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Reference: ${VM0042_DEFINITIONS_CITATION} for term definitions used above.`,
          italics: true,
        }),
      ],
    }),
  );

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}
