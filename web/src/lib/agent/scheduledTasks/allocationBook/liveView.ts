import "server-only";
import type { LetterheadTable } from "../../../reports/letterheadPdf";

export type LiveRowKind = "normal" | "total" | "grand" | "spacer" | "section" | "negative";

export interface LiveRow {
  cells: string[];
  kind: LiveRowKind;
}

export interface LiveTable {
  title?: string;
  /** A column header is either a single line, or [main, sub] for a two-line header (e.g. "Split" / "CN% : Farm%"). */
  headers: (string | [string, string])[];
  rows: LiveRow[];
  notes?: string[];
  /** Index of the column that should get the highlighted "net" treatment (dark header, tinted cells) — mirrors mockTable's netCol in the spec docx. */
  netCol?: number;
}

/** Converts a PDF-oriented LetterheadTable (single-line headers, index-based row styling) into the richer shape the live Book page renders as real HTML/CSS — same computed data, no re-derivation. */
export function toLiveTable(t: LetterheadTable, opts?: { headerOverride?: (string | [string, string])[]; netCol?: number }): LiveTable {
  const bold = new Set(t.boldRowIndexes ?? []);
  const spacer = new Set(t.spacerRowIndexes ?? []);
  const emphasis = new Set(t.emphasisRowIndexes ?? []);
  const rows: LiveRow[] = t.rows.map((cells, i) => {
    let kind: LiveRowKind = "normal";
    if (spacer.has(i)) kind = "spacer";
    else if (emphasis.has(i)) kind = "grand";
    else if (bold.has(i)) kind = "total";
    const netIdx = opts?.netCol ?? -1;
    const negCell = netIdx >= 0 ? cells[netIdx] : cells.find((c) => c.trim().startsWith("-"));
    if (kind === "normal" && negCell && negCell.trim().startsWith("-")) kind = "negative";
    return { cells, kind };
  });
  return {
    title: t.title,
    headers: opts?.headerOverride ?? t.columns.map((c) => c.header),
    rows,
    notes: t.notes,
    netCol: opts?.netCol,
  };
}

export interface AllocationBookView {
  generatedAt: string;
  chapter1: LiveTable;
  chapter1Grand: { credits: number; value: number };
  chapter2: {
    farms: LiveTable;
    carboNature: LiveTable;
    reconciliation: LiveTable;
    reconciled: boolean;
    grossPotential: number;
    totalNetAllocation: number;
    discrepancy: number;
  };
  chapter3: {
    hasAnyRound: boolean;
    tables: LiveTable[];
    bodyParagraphs: string[];
  };
  negativeBalance: {
    active: { scopeType: string; scopeId: string; label: string; thresholdPct: number; balancePctAtTrigger: number; blocksAgriInputs: boolean; blocksProjectFunding: boolean }[];
  };
}

export async function getAllocationBookView(): Promise<AllocationBookView> {
  const { query } = await import("../../../db");
  const { loadPotentialData } = await import("./queries");
  const { buildChapter1Table } = await import("./chapter1");
  const { buildChapter2 } = await import("./chapter2");
  const { buildChapter3 } = await import("./chapter3");

  const data = await loadPotentialData();
  const { table: c1Table, grand: c1Grand } = buildChapter1Table(data);
  const chapter2 = buildChapter2(data, c1Grand.credits, c1Grand.value);
  const chapter3 = await buildChapter3(data);

  const flagRows = await query<{
    scope_type: string;
    scope_id: string;
    threshold_pct: number;
    balance_pct_at_trigger: string;
    blocks_agri_inputs: boolean;
    blocks_project_funding: boolean;
  }>(
    `SELECT scope_type, scope_id, threshold_pct, balance_pct_at_trigger, blocks_agri_inputs, blocks_project_funding
       FROM mrv.negative_balance_flags WHERE status = 'active' ORDER BY threshold_pct ASC`,
  );
  const farmNameById = new Map([...data.byProject.values()].flat().map((r) => [r.farmId, r.farmName]));
  const active = flagRows.map((f) => ({
    scopeType: f.scope_type,
    scopeId: f.scope_id,
    label: f.scope_type === "farm" ? (farmNameById.get(f.scope_id) ?? f.scope_id) : `CarboNature (${f.scope_id})`,
    thresholdPct: f.threshold_pct,
    balancePctAtTrigger: Number(f.balance_pct_at_trigger),
    blocksAgriInputs: f.blocks_agri_inputs,
    blocksProjectFunding: f.blocks_project_funding,
  }));

  return {
    generatedAt: new Date().toISOString(),
    chapter1: toLiveTable(c1Table),
    chapter1Grand: c1Grand,
    chapter2: {
      farms: toLiveTable(chapter2.farmsTable, {
        headerOverride: ["Farm", "Area (ha)", "Agri-Input", ["Split", "CN% : Farm%"], "Gross (VCU)", "Offset (VCU)", "Net (VCU)"],
        netCol: 6,
      }),
      carboNature: toLiveTable(chapter2.carboNatureTable, { netCol: 3 }),
      reconciliation: toLiveTable(chapter2.reconciliationTable),
      reconciled: chapter2.reconciliation.reconciled,
      grossPotential: chapter2.reconciliation.grossPotential,
      totalNetAllocation: chapter2.reconciliation.totalNetAllocation,
      discrepancy: chapter2.reconciliation.discrepancy,
    },
    chapter3: {
      hasAnyRound: chapter3.hasAnyRound,
      tables: chapter3.tables.map((t) => toLiveTable(t)),
      bodyParagraphs: chapter3.bodyParagraphs,
    },
    negativeBalance: { active },
  };
}
