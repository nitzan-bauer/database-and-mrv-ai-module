import "server-only";
import type { LetterheadTable } from "../../../reports/letterheadPdf";
import type { PotentialData } from "./queries";
import type { SaasContractDetail } from "../../../saas/saasClient";

export type LiveRowKind = "normal" | "total" | "grand" | "spacer" | "section" | "negative";

export interface LiveRow {
  cells: string[];
  kind: LiveRowKind;
  /** For Chapter 1 deal rows only — a key into AllocationBookView.chapter1Contracts, letting the row's Transaction # cell open a "view signed agreement" popup (Nitzan, 2026-08-31). Never transaction_no itself — see saasClient.ts's SaasContractDetail doc comment on why. */
  contractKey?: string | null;
}

export interface LiveTable {
  title?: string;
  /** A column header is either a single line, or [main, sub] for a two-line header (e.g. "Split" / "CN% : Farm%"). */
  headers: (string | [string, string])[];
  rows: LiveRow[];
  notes?: string[];
  /** When true, `notes` render as normal readable text instead of small print — for a short key reference line, not a footnote (Nitzan, 2026-09-01). */
  notesReadable?: boolean;
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
    // boldRowIndexes marks BOTH a project-name header row and its "TOTAL —
    // key" subtotal row identically — the live page distinguishes them
    // (Nitzan, 2026-08-31: bolder styling + the word "PROJECT" appended to
    // the header, neither of which applies to a subtotal row) by checking
    // whether every other cell is blank, which only a bare project-name
    // header row is.
    if (kind === "total" && !/^(total|grand total)\b/i.test(cells[0].trim()) && cells.slice(1).every((c) => !c.trim())) {
      kind = "section";
      cells = [`${cells[0]} PROJECT`, ...cells.slice(1)];
    }
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
    notesReadable: (t.notesFontSize ?? 0) >= 9,
    netCol: opts?.netCol,
  };
}

/** The contractKey for a deal row — matches how listContractDetailsByProfileIds' rows are keyed below. */
function contractKeyFor(d: { dealType: string; sourceReservationId: string | null; sourceFinancingId: string | null }): string | null {
  if (d.dealType === "agri_inputs" && d.sourceReservationId) return `res:${d.sourceReservationId}`;
  if (d.dealType === "project_funding" && d.sourceFinancingId) return `fin:${d.sourceFinancingId}`;
  return null;
}

/**
 * Chapter 1 for the live page — same rows/totals as chapter1.ts's PDF
 * table (reuses its exact formatting helpers, no re-derivation), but each
 * deal row also carries a contractKey so its Transaction # cell can open
 * a real "view signed agreement" popup — something the PDF can't do.
 */
async function buildLiveChapter1Table(data: PotentialData): Promise<{ table: LiveTable; grand: { credits: number; value: number } }> {
  const { fmt, usd, pricePerCredit, trackLabel, offsetLabel, formatDealDate } = await import("./chapter1");

  const headers = ["Track", "Farm", "Buyer", "Price", "Credits (VCU)", "Value", "Offset", "Deal date", "Transaction #"];
  const rows: LiveRow[] = [];
  const grand = { credits: 0, value: 0 };

  data.projectOrder.forEach((key, projectIdx) => {
    if (projectIdx > 0) rows.push({ cells: new Array(headers.length).fill(""), kind: "spacer" });
    rows.push({ cells: [`${key.toUpperCase()} PROJECT`, "", "", "", "", "", "", "", ""], kind: "section" });

    const dealsHere = data.dealsByProject.get(key) ?? [];
    const sub = { credits: 0, value: 0 };
    for (const d of dealsHere) {
      rows.push({
        cells: [
          d.isTestData ? `${trackLabel(d.dealType)} (TEST)` : trackLabel(d.dealType),
          d.farmName,
          d.buyerName,
          pricePerCredit(d.value, d.credits),
          fmt(d.credits),
          usd(d.value),
          offsetLabel(d.dealType, d.cnPct),
          formatDealDate(d.signedAt ?? d.createdAt),
          d.transactionNo ?? "-",
        ],
        kind: "normal",
        contractKey: contractKeyFor(d),
      });
      sub.credits += d.credits;
      sub.value += d.value;
    }
    if (!dealsHere.length) rows.push({ cells: ["No deals", "", "", "", "", "", "", "", ""], kind: "normal" });
    rows.push({ cells: ["TOTAL", "", "", "", fmt(sub.credits), usd(sub.value), "", "", ""], kind: "total" });
    grand.credits += sub.credits;
    grand.value += sub.value;
  });

  rows.push({ cells: new Array(headers.length).fill(""), kind: "spacer" });
  rows.push({ cells: ["GRAND TOTAL", "", "", "", fmt(grand.credits), usd(grand.value), "", "", ""], kind: "grand" });

  return {
    table: {
      title: "Chapter 1 — Buyer Transactions Ledger, by project",
      headers,
      rows,
      notes: [
        "* \"Price\" for a Project Funding row is the buyer's real signed $/credit. For an Agri Inputs row it is that input's real application cost divided by the credits it unlocks — a different, unrelated basis, so it will not resemble the standard credit price.",
        "* Click a Transaction # to view the signed agreement.",
      ],
    },
    grand,
  };
}

const CHAPTER2_FARMS_HEADERS: (string | [string, string])[] = [
  "Farm",
  "Area (ha)",
  "Agri-Input",
  ["Split", "CN% : Farm%"],
  "Gross (VCU)",
  "Offset (VCU)",
  "Net (VCU)",
];

/** Chapter 3's honest empty state — real, structurally-correct empty tables (headers only, blank round date) rather than a text-only explanation, per Nitzan's explicit request (2026-08-31): "show the tables empty, and the round date stays empty." Populates automatically once a real round exists (see chapter3.ts). Headers say "Verified", not "Gross" — the Actual vector's own term, per Chapter 2 vs Chapter 3's own terminology split. */
function buildEmptyChapter3Tables(): LiveTable[] {
  const roundHeader: LiveTable = {
    headers: ["Allocation Round", "Issuance Date"],
    rows: [{ cells: ["Round 1 — not yet issued", "—"], kind: "grand" }],
  };
  const farms: LiveTable = {
    title: "3.1 — Net Allocation to Farms (Actual)",
    headers: ["Farm", "Area (ha)", "Agri-Input", ["Split", "CN% : Farm%"], "Verified (VCU)", "Offset (VCU)", "Net (VCU)"],
    rows: [],
  };
  const carboNature: LiveTable = {
    title: "3.2 — Net Allocation to CarboNature (Actual)",
    headers: ["Farm / Buyer", "Verified (VCU)", "Agri-Inputs Offset (VCU)", "Net (VCU)"],
    rows: [],
  };
  const reconciliation: LiveTable = {
    title: "3.3 — Total Credit in Value (Actual)",
    headers: ["Group", "Net Credits (VCU)", "Value"],
    rows: [],
  };
  const actualVsPlan: LiveTable = {
    title: "3.4 — Actual vs Plan",
    headers: ["Farm", "Plan (VCU)", "Actual (VCU)", "Variance (VCU)", "Accuracy %"],
    rows: [],
  };
  return [roundHeader, farms, carboNature, reconciliation, actualVsPlan];
}

export interface AllocationBookView {
  generatedAt: string;
  chapter1: LiveTable;
  chapter1Grand: { credits: number; value: number };
  /** Keyed by "res:<reservationId>" / "fin:<financingId>" — see contractKeyFor. */
  chapter1Contracts: Record<string, SaasContractDetail>;
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
  const { buildChapter2 } = await import("./chapter2");
  const { buildChapter3 } = await import("./chapter3");
  const { listContractDetailsByProfileIds } = await import("../../../saas/saasClient");

  const data = await loadPotentialData();
  const { table: c1Table, grand: c1Grand } = await buildLiveChapter1Table(data);
  const chapter2 = buildChapter2(data, c1Grand.credits, c1Grand.value);
  const chapter3 = await buildChapter3(data);

  const buyerIds = [...new Set(data.dealRows.map((d) => d.buyerId))];
  const contracts = await listContractDetailsByProfileIds(buyerIds);
  const chapter1Contracts: Record<string, SaasContractDetail> = {};
  for (const c of contracts) {
    if (c.reservationId) chapter1Contracts[`res:${c.reservationId}`] = c;
    if (c.financingId) chapter1Contracts[`fin:${c.financingId}`] = c;
  }

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
    chapter1: c1Table,
    chapter1Grand: c1Grand,
    chapter1Contracts,
    chapter2: {
      farms: toLiveTable(chapter2.farmsTable, { headerOverride: CHAPTER2_FARMS_HEADERS, netCol: 6 }),
      carboNature: toLiveTable(chapter2.carboNatureTable, { netCol: 3 }),
      reconciliation: toLiveTable(chapter2.reconciliationTable),
      reconciled: chapter2.reconciliation.reconciled,
      grossPotential: chapter2.reconciliation.grossPotential,
      totalNetAllocation: chapter2.reconciliation.totalNetAllocation,
      discrepancy: chapter2.reconciliation.discrepancy,
    },
    chapter3: {
      hasAnyRound: chapter3.hasAnyRound,
      tables: chapter3.hasAnyRound ? chapter3.tables.map((t) => toLiveTable(t)) : buildEmptyChapter3Tables(),
      bodyParagraphs: chapter3.bodyParagraphs,
    },
    negativeBalance: { active },
  };
}
