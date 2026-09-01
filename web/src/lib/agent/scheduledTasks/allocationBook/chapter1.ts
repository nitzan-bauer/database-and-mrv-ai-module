import "server-only";
import type { LetterheadTable } from "../../../reports/letterheadPdf";
import type { PotentialData } from "./queries";

export function round(n: number): number {
  return Math.round(n);
}
export function fmt(n: number): string {
  return round(n).toLocaleString("en-US");
}
export function usd(n: number): string {
  const v = round(n);
  return v < 0 ? `-$${fmt(-v)}` : `$${fmt(v)}`;
}
export function pricePerCredit(value: number, credits: number): string {
  return credits ? `$${(value / credits).toFixed(2)}` : "-";
}
export function trackLabel(dealType: string): string {
  if (dealType === "agri_inputs") return "Agri Inputs Funding";
  if (dealType === "project_funding") return "Project Funding";
  return dealType;
}
/** Chapter 1's own confirmed format (2026-08-31): "%" signs, e.g. "CN 50% / Farm 50%" — never bare "50/50". */
export function offsetLabel(dealType: string, cnPct: number): string {
  if (dealType === "project_funding") return `CarboNature ${Math.round(cnPct * 100)}%`;
  if (dealType === "agri_inputs") return `CN ${Math.round(cnPct * 100)}% / Farm ${Math.round((1 - cnPct) * 100)}%`;
  return "-";
}
export function formatDealDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB");
}

/**
 * Chapter 1 — Buyer Transactions Ledger. One row per real deal, across
 * both financing tracks, grouped by project with a per-project subtotal
 * and one grand total — per the approved spec (Section 4).
 *
 * 2026-08-31 spec fixes applied here: the "Farm" column always carries
 * the real farm name (never a placeholder), Offset already carries "%"
 * signs (kept from the prior round), and any row sourced from test data
 * (see queries.ts) is tagged "(TEST)" in the Track column — visible in
 * every total, never silently blended into a real number without saying so.
 */
export function buildChapter1Table(data: PotentialData): { table: LetterheadTable; grand: { credits: number; value: number }; sawTestData: boolean } {
  const table: LetterheadTable = {
    title: "Chapter 1 — Buyer Transactions Ledger, by project",
    fontSize: 7,
    columns: [
      { header: "Track", width: 90 },
      { header: "Farm", width: 62 },
      { header: "Buyer", width: 48 },
      { header: "Price", width: 30, align: "right" },
      { header: "Credits (VCU)", width: 40, align: "right" },
      { header: "Value", width: 35, align: "right" },
      { header: "Offset", width: 70 },
      { header: "Deal date", width: 40, align: "right" },
      { header: "Transaction #", width: 68 },
    ],
    rows: [],
    boldRowIndexes: [],
    spacerRowIndexes: [],
    emphasisRowIndexes: [],
  };
  const BLANK_ROW = ["", "", "", "", "", "", "", "", ""];
  let sawTestData = false;
  const grand = { credits: 0, value: 0 };

  data.projectOrder.forEach((key, projectIdx) => {
    if (projectIdx > 0) {
      table.rows.push([...BLANK_ROW]);
      table.spacerRowIndexes!.push(table.rows.length - 1);
    }
    table.rows.push([key.toUpperCase(), "", "", "", "", "", "", "", ""]);
    table.boldRowIndexes!.push(table.rows.length - 1);

    const dealsHere = data.dealsByProject.get(key) ?? [];
    const sub = { credits: 0, value: 0 };
    for (const d of dealsHere) {
      table.rows.push([
        d.isTestData ? `${trackLabel(d.dealType)} (TEST)` : trackLabel(d.dealType),
        d.farmName,
        d.buyerName,
        pricePerCredit(d.value, d.credits),
        fmt(d.credits),
        usd(d.value),
        offsetLabel(d.dealType, d.cnPct),
        formatDealDate(d.signedAt ?? d.createdAt),
        d.transactionNo ?? "-",
      ]);
      if (d.isTestData) sawTestData = true;
      sub.credits += d.credits;
      sub.value += d.value;
    }
    if (!dealsHere.length) table.rows.push(["No deals", "", "", "", "", "", "", "", ""]);
    table.rows.push(["TOTAL", "", "", "", fmt(sub.credits), usd(sub.value), "", "", ""]);
    table.boldRowIndexes!.push(table.rows.length - 1);
    grand.credits += sub.credits;
    grand.value += sub.value;
  });

  table.rows.push([...BLANK_ROW]);
  table.spacerRowIndexes!.push(table.rows.length - 1);
  table.rows.push(["GRAND TOTAL", "", "", "", fmt(grand.credits), usd(grand.value), "", "", ""]);
  table.emphasisRowIndexes!.push(table.rows.length - 1);

  // No footnotes on this table — Nitzan's explicit instruction (2026-09-01):
  // the small print under Chapters 1 and 2's tables wasn't relevant. A
  // (TEST) row is still tagged in the Track column itself if one ever
  // appears; that tag alone is the signal now, no explanatory footnote.

  return { table, grand, sawTestData };
}
