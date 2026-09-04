import "server-only";
import type { LetterheadTable } from "../../../reports/letterheadPdf";
import type { PotentialData } from "./queries";

function round(n: number): number {
  return Math.round(n);
}
function fmt(n: number): string {
  return round(n).toLocaleString("en-US");
}
function usd(n: number): string {
  const v = round(n);
  return v < 0 ? `-$${fmt(-v)}` : `$${fmt(v)}`;
}
/** Section 5.1's confirmed format (2026-08-31): "50% : 50%" (CN% : Farm%), never bare "50/50". */
function splitLabel(farmerSharePct: number): string {
  const cnPct = Math.round((1 - farmerSharePct) * 100);
  const farmPct = Math.round(farmerSharePct * 100);
  return `${cnPct}% : ${farmPct}%`;
}

export interface Chapter2Result {
  farmsTable: LetterheadTable;
  carboNatureTable: LetterheadTable;
  reconciliationTable: LetterheadTable;
  reconciliation: {
    grossPotential: number;
    farmNetTotal: number;
    cnNetTotal: number;
    buyerNetTotal: number;
    totalNetAllocation: number;
    reconciled: boolean;
    discrepancy: number;
  };
}

/**
 * Chapter 2 — Potential Credit Allocation (Sections 5.1/5.2/5.3), per the
 * approved spec (2026-08-31, Round 3, all 4 flagged decisions resolved):
 *  - 5.1: Split column formatted "CN% : Farm%", units on every credit header.
 *  - 5.2: same formatting; CarboNature's own Gross/Offset decomposed so
 *    Gross - Offset = Net exactly (see the reconciling algebra in this
 *    file's own comment on cnGrossShare/cnOffsetShare below).
 *  - 5.3: an explicit Gross Potential row plus a RECONCILED/NOT RECONCILED
 *    line — quantity only, never monetary value, per Nitzan's explicit
 *    confirmation. The identity checked is exact by construction:
 *    farmNet + cnNet + buyerNet == grossPotential always (proof: the
 *    Agri-Inputs offset nets out of both sides' pre-split subtotal
 *    identically to how it's later re-added via the Credit Buyers total,
 *    and Project Funding's -P/+P cancel the same way) — a mismatch here
 *    means a real bug upstream (a farm counted twice, a released row not
 *    excluded), not an expected value-vs-quantity gap.
 */
export function buildChapter2(data: PotentialData, buyerGrandCredits: number, buyerGrandValue: number): Chapter2Result {
  // ---------- 5.1 — Net Allocation to Farms ----------
  const farmsTable: LetterheadTable = {
    title: "2.1 — Net Allocation to Farms, by project",
    fontSize: 7,
    columns: [
      { header: "Farm", width: 90 },
      { header: "Area (ha)", width: 44, align: "right" },
      { header: "Agri-Input", width: 60 },
      { header: "Split (CN%:Farm%)", width: 68, align: "right" },
      { header: "Gross (VCU)", width: 46, align: "right" },
      { header: "Offset (VCU)", width: 48, align: "right" },
      { header: "Net (VCU)", width: 46, align: "right" },
    ],
    rows: [],
    boldRowIndexes: [],
    spacerRowIndexes: [],
    emphasisRowIndexes: [],
  };
  const BLANK7 = ["", "", "", "", "", "", ""];

  // ---------- 5.2 — Net Allocation to CarboNature ----------
  const cnTable: LetterheadTable = {
    title: "2.2 — Net Allocation to CarboNature, by project",
    fontSize: 7,
    columns: [
      { header: "Farm / Buyer", width: 140 },
      { header: "Gross (VCU)", width: 60, align: "right" },
      { header: "Agri-Inputs Offset (VCU)", width: 90, align: "right" },
      { header: "Net (VCU)", width: 60, align: "right" },
    ],
    rows: [],
    boldRowIndexes: [],
    spacerRowIndexes: [],
    emphasisRowIndexes: [],
  };
  const BLANK4 = ["", "", "", ""];

  let farmNetTotal = 0;
  let cnNetTotal = 0;

  data.projectOrder.forEach((key, projectIdx) => {
    const farmRows = data.byProject.get(key)!;
    const projectLevel = data.projectLevelDeals.get(key);

    if (projectIdx > 0) {
      farmsTable.rows.push([...BLANK7]);
      farmsTable.spacerRowIndexes!.push(farmsTable.rows.length - 1);
      cnTable.rows.push([...BLANK4]);
      cnTable.spacerRowIndexes!.push(cnTable.rows.length - 1);
    }
    farmsTable.rows.push([key.toUpperCase(), "", "", "", "", "", ""]);
    farmsTable.boldRowIndexes!.push(farmsTable.rows.length - 1);
    cnTable.rows.push([key.toUpperCase(), "", "", ""]);
    cnTable.boldRowIndexes!.push(cnTable.rows.length - 1);

    const farmSub = { area: 0, gross: 0, offset: 0, net: 0 };
    const cnSub = { gross: 0, offset: 0, net: 0 };

    for (const r of farmRows) {
      // Gross/Offset shown as the FARM's own 50%-share of each (matching
      // exactly how the CarboNature table below already shows CN's share),
      // not the deal's raw full-potential/full-offset — so Gross - Offset
      // = Net reconciles by simple arithmetic, and the split (buyer's
      // offset always shared equally, see cnOffsetShare below) is visibly
      // symmetric rather than looking like the farm absorbs the whole
      // offset (a real, reasonable misreading flagged live 2026-09-01 —
      // the underlying math was always a true 50:50 split; the previous
      // display style just made it look like 100% hit the farm).
      const farmGrossShare = r.farmPotential * r.farmerSharePct;
      const farmOffsetShare = -(r.buyerCredits * r.farmerSharePct);
      farmsTable.rows.push([
        r.includesTestData ? `${r.farmName} (TEST)` : r.farmName,
        fmt(r.areaHa),
        r.agriInputs ?? "-",
        splitLabel(r.farmerSharePct),
        fmt(farmGrossShare),
        fmt(farmOffsetShare),
        fmt(r.farmCredits),
      ]);
      farmSub.area += r.areaHa;
      farmSub.gross += farmGrossShare;
      farmSub.offset += farmOffsetShare;
      farmSub.net += r.farmCredits;

      // CarboNature's own Gross/Offset, decomposed so Gross - Offset = Net
      // exactly (see this file's header comment) — cnCredits (r.cnCredits)
      // is the real, already-computed net; this just shows its two parts.
      const cnGrossShare = r.farmPotential * (1 - r.farmerSharePct);
      const cnOffsetShare = -(r.buyerCredits * (1 - r.farmerSharePct));
      cnTable.rows.push([r.farmName, fmt(cnGrossShare), fmt(cnOffsetShare), fmt(r.cnCredits)]);
      cnSub.gross += cnGrossShare;
      cnSub.offset += cnOffsetShare;
      cnSub.net += r.cnCredits;
    }

    if (projectLevel) {
      cnTable.rows.push(["Project Funding (no single farm)", fmt(0), "-", fmt(-projectLevel.credits)]);
      cnSub.net += -projectLevel.credits;
    }

    farmsTable.rows.push([`TOTAL — ${key}`, fmt(farmSub.area), "", "", fmt(farmSub.gross), fmt(farmSub.offset), fmt(farmSub.net)]);
    farmsTable.boldRowIndexes!.push(farmsTable.rows.length - 1);
    cnTable.rows.push([`TOTAL — ${key}`, fmt(cnSub.gross), fmt(cnSub.offset), fmt(cnSub.net)]);
    cnTable.boldRowIndexes!.push(cnTable.rows.length - 1);

    farmNetTotal += farmSub.net;
    cnNetTotal += cnSub.net;
  });

  farmsTable.rows.push([...BLANK7]);
  farmsTable.spacerRowIndexes!.push(farmsTable.rows.length - 1);
  farmsTable.rows.push(["GRAND TOTAL", "", "", "", "", "", fmt(farmNetTotal)]);
  farmsTable.emphasisRowIndexes!.push(farmsTable.rows.length - 1);

  cnTable.rows.push([...BLANK4]);
  cnTable.spacerRowIndexes!.push(cnTable.rows.length - 1);
  cnTable.rows.push(["GRAND TOTAL", "", "", fmt(cnNetTotal)]);
  cnTable.emphasisRowIndexes!.push(cnTable.rows.length - 1);

  // No footnotes on 2.1/2.2's own tables — Nitzan's explicit instruction
  // (2026-09-01). The one thing worth keeping visible in Chapter 2 — the
  // credit-yield keys the Gross figures above are built from — gets its
  // own short, readable-font line instead (see PLOT_TYPE_LABELS below),
  // not small print.
  const PLOT_TYPE_LABELS: Record<string, string> = { open_field: "Open Field", young_orchard: "Young Orchard", mature_orchard: "Mature Orchard" };
  const yieldKeyLines = [...data.rateByPlotType.entries()]
    .map(([type, rate]) => `${PLOT_TYPE_LABELS[type] ?? type}: ${rate} VCU/ha`)
    .join("  |  ");
  farmsTable.notes = yieldKeyLines ? [`Credit-yield keys (set in the SaaS's Project Financing settings) — ${yieldKeyLines}`] : [];
  farmsTable.notesFontSize = 9.5;

  // ---------- 5.3 — TOTAL CREDIT IN VALUE (reconciliation gate) ----------
  const allFarmRows = [...data.byProject.values()].flat();
  const gross = allFarmRows.reduce((s, r) => s + r.farmPotential, 0);
  const totalNetAllocation = farmNetTotal + cnNetTotal + buyerGrandCredits;
  const discrepancy = gross - totalNetAllocation;
  const reconciled = Math.abs(discrepancy) < 0.01;

  const reconciliationTable: LetterheadTable = {
    title: "2.3 — TOTAL CREDIT IN VALUE",
    columns: [
      { header: "Group", width: 220 },
      { header: "Net Credits (VCU)", width: 100, align: "right" },
      { header: "Value", width: 100, align: "right" },
    ],
    rows: (() => {
      const farmValueTotal = allFarmRows.reduce((s, r) => s + r.farmValue, 0);
      const cnValueBeforePF = allFarmRows.reduce((s, r) => s + r.cnValue, 0);
      const pfValueDeduction = [...data.projectLevelDeals.values()].reduce(
        (s, p) => s + p.credits * (data.priceByProject.get(p.projectId) ?? 0),
        0,
      );
      const cnValueTotal = cnValueBeforePF - pfValueDeduction;
      const totalValue = farmValueTotal + cnValueTotal + buyerGrandValue;
      return [
        ["Gross Potential", fmt(gross), "-"],
        ["Farms", fmt(farmNetTotal), usd(farmValueTotal)],
        ["CarboNature", fmt(cnNetTotal), usd(cnValueTotal)],
        ["Buyers", fmt(buyerGrandCredits), usd(buyerGrandValue)],
        ["Total Net Allocation", fmt(totalNetAllocation), usd(totalValue)],
        reconciled
          ? [`RECONCILED - Gross Potential (${fmt(gross)} VCU) = Total Net Allocation (${fmt(totalNetAllocation)} VCU)`, "", ""]
          : [`NOT RECONCILED - discrepancy of ${fmt(Math.abs(discrepancy))} VCU`, "", ""],
      ];
    })(),
    boldRowIndexes: [0, 4],
    emphasisRowIndexes: [5],
    spacerRowIndexes: [],
    // No footnotes here either — Nitzan's explicit instruction (2026-09-01).
    // The quantity-only / bounded-retry rules are still fully in force
    // (see negativeBalance.ts, reconciliation logic above); they're just
    // no longer restated as small print under this table every run.
  };

  return {
    farmsTable,
    carboNatureTable: cnTable,
    reconciliationTable,
    reconciliation: { grossPotential: gross, farmNetTotal, cnNetTotal, buyerNetTotal: buyerGrandCredits, totalNetAllocation, reconciled, discrepancy },
  };
}
