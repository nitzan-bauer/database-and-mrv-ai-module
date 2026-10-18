"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import type {
  ActivityData,
  EmissionResult,
  FertilizerApplication,
  IrrigationMethod,
  Leakage841Result,
  WorkingLine,
} from "@/lib/ghg/engine";
import type { LeakageEntry, Project, ClimateZone } from "@/lib/data/types";
import type { RecordedActivityData } from "@/lib/tools/recordActivityData";
import type { ToolResult } from "@/lib/tools/context";
import { ActivityDataForm } from "./ActivityDataForm";

const DASH = "—";

export interface FarmSheet {
  farmId: string;
  name: string;
  climateZone: ClimateZone | null;
  irrigationMethod: IrrigationMethod | null;
  totalAreaHa: number;
  quantificationApproaches: string[];
  bsl: { activity: ActivityData; emissions: EmissionResult; working: WorkingLine[] } | null;
  bslSkipReason: string | null;
  /** Every recorded BSL year as its own row — the source workbook never collapses these to the average; only the rollup (bsl above) does. */
  bslRows: Array<{ activity: ActivityData; emissions: EmissionResult }>;
  pr: { activity: ActivityData; emissions: EmissionResult; working: WorkingLine[] } | null;
  prSkipReason: string | null;
  prRows: Array<{ activity: ActivityData; emissions: EmissionResult }>;
  reduction: { perHa: number; total: number } | null;
  leakage841: Leakage841Result | null;
}

type RecordActivityAction = (input: {
  farmId: string;
  scenario: "BSL" | "PR" | "WP";
  year: number;
  areaHa: number;
  dieselL?: number;
  gasolineL?: number;
  residueBurntKg?: number;
  nfixDryMatterT?: number;
  nfixNContent?: number;
  fertilizers: Array<{ fertilizerName: string; massT: number; intervalYears?: number }>;
}) => Promise<ToolResult<RecordedActivityData>>;

// Tab set and order mirror the source workbook's own sheet tabs exactly,
// minus the 3 that live in the Reference Hub instead (Fixed Parameters,
// Fertilizer Library, Equations — the same for every project, so they sit
// outside any one project's tab set). "Sheet1" (blank in the source file)
// is not a real sheet and is not reproduced.
const TABS = [
  { key: "cover", label: "Cover" },
  { key: "readme", label: "README" },
  { key: "machinery-diesel", label: "Machinery-Diesel" },
  { key: "baseline-inputs", label: "Baseline Inputs" },
  { key: "project-inputs", label: "Project Inputs" },
  { key: "baseline-emissions", label: "Baseline Emissions" },
  { key: "project-emissions", label: "Project Emissions" },
  { key: "net-reductions", label: "Net Reductions" },
  { key: "soc-removals", label: "SOC Removals (QA1)" },
  { key: "leakage", label: "Leakage" },
  { key: "summary", label: "Project Summary (VVB)" },
  { key: "index", label: "Index" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * The GHG Calculator as a real workbook — one tab per source-Excel sheet,
 * in the source's own order, each one a real spreadsheet-style table
 * (columns matching the workbook's own headers, one row per farm or per
 * farm-year) rather than a per-farm card. Nitzan's own spec (2026-09-12,
 * after reviewing the app against
 * "H:\My Drive\carbonature\GHG Calculation and project DATA\
 * GHG_Calculator_VM0042_v2.2_OpenField_v1.xlsx" directly): "זה צריך
 * להיראות אחד לאחד כמו בסט גיליונות של האקסל" (this needs to look
 * one-to-one like the Excel sheet set) — "טבלה אחת עם שמות החוות
 * המשתתפות" (one table with the names of the participating farms), not
 * a card per farm. A farm with no data for a sheet still gets a real row
 * in that sheet's table (dashes, never invented numbers, never dropped).
 */
export function GhgWorkbook({
  project,
  sheets,
  manualLeakage,
  fertilizers,
  recordActivityDataAction,
}: {
  project: Project;
  sheets: FarmSheet[];
  manualLeakage: LeakageEntry[];
  fertilizers: Array<{ name: string; nContent: number; class: string }>;
  recordActivityDataAction?: RecordActivityAction;
}) {
  const [tab, setTab] = useState<TabKey>("summary");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors " +
              (tab === t.key ? "border-pine-600 text-pine-700" : "border-transparent text-muted hover:text-pine-600")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cover" && <CoverTab project={project} />}
      {tab === "readme" && <ReadmeTab />}
      {tab === "machinery-diesel" && <MachineryDieselTab />}
      {tab === "baseline-inputs" && (
        <InputsWideTable scenario="BSL" sheets={sheets} fertilizers={fertilizers} recordActivityDataAction={recordActivityDataAction} />
      )}
      {tab === "project-inputs" && (
        <InputsWideTable scenario="PR" sheets={sheets} fertilizers={fertilizers} recordActivityDataAction={recordActivityDataAction} />
      )}
      {tab === "baseline-emissions" && <EmissionsWideTable scenario="BSL" sheets={sheets} />}
      {tab === "project-emissions" && <EmissionsWideTable scenario="PR" sheets={sheets} />}
      {tab === "net-reductions" && <NetReductionsTab sheets={sheets} />}
      {tab === "soc-removals" && <SocRemovalsTab sheets={sheets} />}
      {tab === "leakage" && <LeakageTab sheets={sheets} manualLeakage={manualLeakage} />}
      {tab === "summary" && <SummaryTab project={project} sheets={sheets} manualLeakage={manualLeakage} />}
      {tab === "index" && <IndexTab />}
    </div>
  );
}

/* ───────────────────────── shared formatting ───────────────────────── */

function fmt(n: number | null | undefined, dp = 4): string {
  return n == null ? DASH : n.toFixed(dp);
}

function th(children: ReactNode, extra = "") {
  return <th className={"px-2.5 py-2 font-semibold " + extra}>{children}</th>;
}

/* ───────────────────────── Cover ───────────────────────── */

function CoverTab({ project }: { project: Project }) {
  const identification: Array<[string, string, string?]> = [
    ["Project title", project.name],
    ["VCS project ID", "«enter»"],
    ["Project proponent", "CarboNature"],
    ["Country / region", project.country || "«enter»"],
    ["Crop(s) — open field", "«enter»"],
    ["Methodology", project.methodology || "VM0042 v2.2 (Improved Agricultural Land Management)"],
    ["Module", "VMD0053 (Model Calibration, Validation & Uncertainty)", "Applicable when SOC / soil N₂O use QA1."],
    ["Crediting period", "«enter»"],
    ["Monitoring / reporting period", "«enter»"],
    ["Prepared by", "«enter»"],
    ["Date", "«enter»"],
    ["Spreadsheet version", "v1.0"],
  ];
  const basis: Array<[string, string, string?]> = [
    ["GWP source", "IPCC AR5 (2013): N₂O = 265, CH₄ = 28", 'Mandated by VM0042 v2.2. Editable in "Fixed Parameters".'],
    ["Emission factors", "IPCC 2019 Refinement (default factors, QA3)", 'EF_N_direct, Frac_GASF/GASM, Frac_LEACH, etc. — see "Fixed Parameters" + "Index".'],
    ["Conservativeness", "EF_N_direct 0.013↓ / 0.019↑ per project N trend (§8.3)"],
  ];
  const approachMap: Array<[string, string, string]> = [
    ["SOC stock change (removals)", "QA3/QA1 selector → QA3", "SOC Removals (QA1)"],
    ["Soil N₂O (fertilizer + N-fixing)", "={selector}", "Baseline Emissions / SOC Removals (QA1)"],
    ["Fossil-fuel CO₂", "QA3 — Default factors", "Baseline Emissions / Project Emissions"],
    ["Residue-burning N₂O", "QA3 — Default factors", "Baseline Emissions / Project Emissions"],
  ];
  const traceability: Array<[string, string, string, string]> = [
    ["CO₂ from fossil fuel", "6, 7", "Baseline Emissions / Project Emissions", "K"],
    ["N₂O direct (fertilizer N)", "18, 19, 20", "Baseline Emissions / Project Emissions", "F (FSN/FON in D,E)"],
    ["N₂O indirect (volat. + leach.)", "21, 22, 23", "Baseline Emissions / Project Emissions", "G, H, I"],
    ["N₂O from N-fixing residue", "24, 25", "Baseline Emissions / Project Emissions", "M"],
    ["N₂O from residue burning", "32", "Baseline Emissions / Project Emissions", "L"],
    ["Net reductions (baseline − project)", "37, 38", "Net Reductions", "H"],
    ["SOC removals", "4, 5, 40, 41", "SOC Removals (QA1)", "I"],
    ["Estimated VCUs", "—", "Project Summary (VVB)", "—"],
  ];
  const companions: Array<[string, string, string]> = [
    ["Model Validation Report (MVR)", "Proponent-authored, per VMD0053", "Required under QA1. See MVR template/skeleton."],
    ["IME Assessment Report", "Authored by the IME hired by the VVB", "Confirms model applicability, calibration, prediction error."],
    ["ESM worksheet (SOC)", "Wendt & Hauser 2013 (Verra)", "Equivalent Soil Mass for SOC stock comparison (QA1/QA2)."],
    ["Methodology & corrections", "VM0042 v2.2 PDF + Corrections 11JUN2026", ""],
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-lg font-bold text-pine-700">ERR Quantification Spreadsheet</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Verra VCS · VM0042 v2.2 (Improved Agricultural Land Management) · prepared for VVB validation/verification
        </p>
      </Card>
      <CoverSection title="1 · Project identification" rows={identification} />
      <CoverSection title="2 · GHG accounting basis" rows={basis} />

      <Card className="overflow-hidden p-0">
        <h3 className="border-b border-line bg-pine-50 px-4 py-2.5 text-[13px] font-bold text-pine-700">
          3 · Quantification approach map (per pool/source) — §8.1
        </h3>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              {th("Pool / source")}
              {th("Approach")}
              {th("Computed in")}
            </tr>
          </thead>
          <tbody>
            {approachMap.map(([a, b, c]) => (
              <tr key={a} className="border-t border-line">
                <td className="px-2.5 py-2 text-ink">{a}</td>
                <td className="px-2.5 py-2 font-mono text-[11.5px] text-muted">{b}</td>
                <td className="px-2.5 py-2 text-muted">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line bg-cream/60 px-4 py-2 text-[11.5px] text-faint">
          Each source uses the SAME approach in baseline and project; strata on different approaches are accounted
          separately (no double-counting).
        </p>
      </Card>

      <Card className="overflow-hidden p-0">
        <h3 className="border-b border-line bg-pine-50 px-4 py-2.5 text-[13px] font-bold text-pine-700">
          4 · ERR traceability map (equation → sheet)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                {th("Quantity")}
                {th("VM0042 eq.")}
                {th("Sheet")}
                {th("Column")}
              </tr>
            </thead>
            <tbody>
              {traceability.map(([q, eq, s, col]) => (
                <tr key={q} className="border-t border-line">
                  <td className="px-2.5 py-2 text-ink">{q}</td>
                  <td className="px-2.5 py-2 font-mono text-[11.5px] font-semibold text-pine-600">{eq}</td>
                  <td className="px-2.5 py-2 text-muted">{s}</td>
                  <td className="px-2.5 py-2 font-mono text-[11.5px] text-faint">{col}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <h3 className="border-b border-line bg-pine-50 px-4 py-2.5 text-[13px] font-bold text-pine-700">
          5 · Companion documents (VVB package)
        </h3>
        <table className="w-full text-[12.5px]">
          <tbody>
            {companions.map(([a, b, c]) => (
              <tr key={a} className="border-t border-line">
                <td className="px-2.5 py-2 font-semibold text-ink">{a}</td>
                <td className="px-2.5 py-2 text-muted">{b}</td>
                <td className="px-2.5 py-2 text-faint">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden p-0">
        <h3 className="border-b border-line bg-pine-50 px-4 py-2.5 text-[13px] font-bold text-pine-700">6 · Version control</h3>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              {th("Version")}
              {th("Date")}
              {th("Author")}
              {th("Summary of changes")}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-2.5 py-2 font-mono text-ink">v1.0</td>
              <td className="px-2.5 py-2 font-mono text-muted">«enter»</td>
              <td className="px-2.5 py-2 text-muted">CarboNature</td>
              <td className="px-2.5 py-2 text-muted">Initial ERR quantification spreadsheet</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function CoverSection({ title, rows }: { title: string; rows: Array<[string, string, string?]> }) {
  return (
    <Card className="overflow-hidden p-0">
      <h3 className="border-b border-line bg-pine-50 px-4 py-2.5 text-[13px] font-bold text-pine-700">{title}</h3>
      <dl className="divide-y divide-line">
        {rows.map(([label, value, note]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2 text-[13px]">
            <dt className="text-muted">{label}</dt>
            <dd className={"text-right font-medium " + (value === "«enter»" ? "font-mono text-gold-600" : "text-ink")}>
              {value}
              {note && <span className="ml-2 block text-[11px] font-normal text-faint">{note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* ───────────────────────── README ───────────────────────── */

function ReadmeTab() {
  const facts: Array<[string, string]> = [
    [
      "Purpose",
      "Computes baseline and project GHG emissions from nitrogen fertilizers and fossil fuel, per quantification unit (farm/plot) per year, for multi-year monitoring under Verra VM0042 v2.2. Output is VVB-audit ready.",
    ],
    [
      "Methodology",
      "VM0042 v2.2 (Improved ALM). Emission factors per the 2019 Refinement to the 2006 IPCC Guidelines, Vol.4 Ch.11 (N2O) & Ch.2/Vol.2 Ch.3 (fuel, burning). GWP per IPCC AR5 (2013).",
    ],
    [
      "Scope (Phase 1)",
      "Open-field crops only (NOT orchards/groves/forests). Sources: CO2 from fossil-fuel combustion; direct & indirect N2O from synthetic + organic N fertilizers; N2O from N-fixing crop residues; N2O from agricultural-residue burning.",
    ],
    [
      "Out of scope (Phase 2)",
      "Leakage (activity-shifting / market / ecological); SOC modeling; liming & urea CO2; rice CH4; manure-deposition N2O from grazing. Placeholders are included where relevant.",
    ],
    [
      "Baseline rule",
      'Baseline = average of the 3 years preceding the project start date (enter the 3 years per farm in "Baseline Inputs").',
    ],
  ];
  const colours: Array<[string, string]> = [
    ["INPUT (yellow)", "enter your activity data here (invoices, declarations, machinery, etc.)"],
    ["CALCULATED (grey)", "live formula, do not overwrite"],
    ["FIXED PARAMETER (blue)", "emission factors & constants, defaulted to VM0042 v2.2 / IPCC 2019. Editable only with documented justification."],
    ["REMOVALS / QA1 (purple)", "soil-carbon (SOC) measure-&-model inputs for the hybrid model."],
  ];
  const guide: Array<[string, string]> = [
    ["Index", "Every variable & parameter: symbol, unit, equation, description, source."],
    ["Equations", "Every VM0042 v2.2 equation used, written out with plain explanation."],
    ["Fixed Parameters", "Emission factors, GWP, fractions — with climate-zone & conservativeness logic."],
    ["Fertilizer Library", "Common fertilizers & their N content (auto-looked-up by name)."],
    ["Machinery-Diesel", "Convert machinery HP × hours/ha × area → diesel litres (feeds fuel input)."],
    ["Baseline / Project Inputs", "Activity data per farm-year (fertilizers, fuel, residues, N-fixing)."],
    ["Baseline / Project Emissions", "Per-row computed emissions (live formulas)."],
    ["Net Reductions", "Baseline − Project per source = emission reductions (+ leakage placeholder)."],
    ["Project Summary (VVB)", "Roll-up across all farms — the sheet to hand to the VVB."],
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-lg font-bold text-pine-700">CarboNature — GHG Calculator</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          VM0042 v2.2 · Improved Agricultural Land Management · Open-Field crops · Quantification Approach 3 (Default
          Factors)
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        <dl className="divide-y divide-line">
          {facts.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="text-[12.5px] font-semibold text-pine-700">{label}</dt>
              <dd className="text-[13px] leading-relaxed text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-[13px] font-bold text-pine-700">How to read the colours</h3>
        <dl className="space-y-2">
          {colours.map(([label, value]) => (
            <div key={label} className="text-[13px]">
              <dt className="inline font-mono font-semibold text-pine-700">{label}</dt>
              <dd className="inline text-muted"> — {value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-[13px] font-bold text-pine-700">Sheet guide</h3>
        <dl className="divide-y divide-line">
          {guide.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-2 sm:grid-cols-[220px_1fr] sm:gap-4">
              <dt className="text-[12.5px] font-semibold text-ink">{label}</dt>
              <dd className="text-[12.5px] text-muted">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/* ───────────────────────── Machinery-Diesel ───────────────────────── */

const MACHINERY_ROWS: Array<{
  equipment: string;
  ratedHp: number;
  ratedKw: number;
  loadFactor: number;
  sfc: number;
  hoursPerHa: number;
  areaHa: number;
}> = [
  { equipment: "Tractor (heavy, ploughing)", ratedHp: 120, ratedKw: 89.5, loadFactor: 0.55, sfc: 0.27, hoursPerHa: 6, areaHa: 50 },
  { equipment: "Tractor (medium, spraying)", ratedHp: 80, ratedKw: 59.7, loadFactor: 0.45, sfc: 0.27, hoursPerHa: 3, areaHa: 50 },
  { equipment: "Combine harvester", ratedHp: 250, ratedKw: 186.4, loadFactor: 0.6, sfc: 0.27, hoursPerHa: 1.5, areaHa: 50 },
];

function MachineryDieselTab() {
  const rows = MACHINERY_ROWS.map((r) => ({ ...r, dieselL: r.ratedKw * r.loadFactor * r.sfc * r.hoursPerHa * r.areaHa }));
  const total = rows.reduce((s, r) => s + r.dieselL, 0);
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-[13.5px] font-bold text-pine-700">Machinery → Diesel</h3>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Estimate diesel litres from machinery when fuel invoices are unavailable. Litre total can be pasted into the
          fuel column of an Inputs row.
        </p>
        <p className="mt-1 font-mono text-[11px] text-faint">
          Diesel (L) = Rated power (kW) × Load factor × SFC (L/kWh) × Hours per ha × Area (ha). Rated kW = HP ×
          0.7457. Default SFC ≈ 0.27 L/kWh (IPCC 2019 / EPA NONROAD diesel).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              {th("Equipment")}
              {th("Rated HP", "text-right")}
              {th("Rated kW", "text-right")}
              {th("Load factor", "text-right")}
              {th("SFC (L/kWh)", "text-right")}
              {th("Hours/ha", "text-right")}
              {th("Area (ha)", "text-right")}
              {th("Diesel (L)", "text-right")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.equipment} className="border-t border-line">
                <td className="px-2.5 py-2 text-ink">{r.equipment}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">{r.ratedHp}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">{r.ratedKw}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">{r.loadFactor}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">{r.sfc}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">{r.hoursPerHa}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-muted">{r.areaHa}</td>
                <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-pine-700">
                  {r.dieselL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-pine-600 bg-pine-50 font-semibold">
              <td colSpan={7} className="px-2.5 py-2 text-right text-pine-700">
                TOTAL diesel (L)
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums text-pine-700">
                {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-line bg-cream/60 px-4 py-2 text-[11px] text-faint">
        Reference example rows from the source workbook — replace with your own equipment before pasting a litre total
        into an Inputs row.
      </p>
    </Card>
  );
}

/* ───────────────────────── Baseline / Project Inputs ───────────────────────── */

function splitFertilizers(fs: FertilizerApplication[]) {
  const organics = fs.filter((f) => f.class === "organic");
  const synthetics = fs.filter((f) => f.class !== "organic");
  return {
    organic: organics[0] ?? null,
    organicExtra: Math.max(0, organics.length - 1),
    synth: [synthetics[0] ?? null, synthetics[1] ?? null, synthetics[2] ?? null] as Array<FertilizerApplication | null>,
    synthExtra: Math.max(0, synthetics.length - 3),
  };
}

function InputsWideTable({
  scenario,
  sheets,
  fertilizers,
  recordActivityDataAction,
}: {
  scenario: "BSL" | "PR";
  sheets: FarmSheet[];
  fertilizers: Array<{ name: string; nContent: number; class: string }>;
  recordActivityDataAction?: RecordActivityAction;
}) {
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13.5px] font-bold text-pine-700">
            {scenario === "BSL" ? "Baseline Inputs" : "Project Inputs"}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {scenario === "BSL"
              ? "Activity data for the 3 years preceding project start (one row per farm-year). Every recorded year — never just the average."
              : "Activity data per monitoring year (one row per farm-year)."}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12px]">
            <thead className="bg-cream font-mono text-[9.5px] uppercase tracking-wide text-faint">
              <tr>
                <th rowSpan={2} className="border-b border-line px-2.5 py-1.5 text-left align-bottom">Farm / unit</th>
                <th rowSpan={2} className="border-b border-line px-2.5 py-1.5 text-left align-bottom">Year</th>
                <th rowSpan={2} className="border-b border-line px-2.5 py-1.5 text-right align-bottom">Area (ha)</th>
                <th colSpan={4} className="border-b border-l border-line px-2.5 py-1 text-center">Organic fert</th>
                <th colSpan={3} className="border-b border-l border-line px-2.5 py-1 text-center">Synthetic fert 1</th>
                <th colSpan={3} className="border-b border-l border-line px-2.5 py-1 text-center">Synthetic fert 2</th>
                <th colSpan={3} className="border-b border-l border-line px-2.5 py-1 text-center">Synthetic fert 3</th>
                <th colSpan={2} className="border-b border-l border-line px-2.5 py-1 text-center">Fuel</th>
                <th rowSpan={2} className="border-b border-l border-line px-2.5 py-1.5 text-right align-bottom">Residue burnt (kg)</th>
                <th colSpan={2} className="border-b border-l border-line px-2.5 py-1 text-center">N-fixing crop residue</th>
              </tr>
              <tr>
                <th className="border-b border-l border-line px-2.5 py-1.5 text-left">Name</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">Mass (t)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">N (tN/t)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">Interval (yr)</th>
                <th className="border-b border-l border-line px-2.5 py-1.5 text-left">Name</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">Mass (t)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">N (tN/t)</th>
                <th className="border-b border-l border-line px-2.5 py-1.5 text-left">Name</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">Mass (t)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">N (tN/t)</th>
                <th className="border-b border-l border-line px-2.5 py-1.5 text-left">Name</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">Mass (t)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">N (tN/t)</th>
                <th className="border-b border-l border-line px-2.5 py-1.5 text-right">Diesel (L)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">Gasoline (L)</th>
                <th className="border-b border-l border-line px-2.5 py-1.5 text-right">Dry matter (t)</th>
                <th className="border-b border-line px-2.5 py-1.5 text-right">N (tN/t d.m.)</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => {
                const rows = scenario === "BSL" ? s.bslRows : s.prRows;
                const skipReason = scenario === "BSL" ? s.bslSkipReason : s.prSkipReason;
                if (rows.length === 0) {
                  return (
                    <tr key={s.farmId} className="border-t border-line">
                      <td className="px-2.5 py-2 font-semibold text-ink">{s.name}</td>
                      <td colSpan={20} className="px-2.5 py-2 text-[11.5px] text-faint">
                        No {scenario === "BSL" ? "baseline" : "project-year"} data recorded
                        {skipReason ? ` — ${skipReason}` : ""}.
                      </td>
                    </tr>
                  );
                }
                return rows.map(({ activity: a }, i) => {
                  const { organic, organicExtra, synth, synthExtra } = splitFertilizers(a.fertilizers);
                  return (
                    <tr key={`${s.farmId}-${i}`} className="border-t border-line">
                      {i === 0 ? (
                        <td rowSpan={rows.length} className="border-r border-line/60 px-2.5 py-2 align-top font-semibold text-ink">
                          {s.name}
                        </td>
                      ) : null}
                      <td className="px-2.5 py-2 tabular-nums text-muted">{a.year}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{a.areaHa}</td>
                      <td className="border-l border-line/60 px-2.5 py-2 text-ink">{organic?.fertilizerName ?? DASH}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{organic ? organic.massT : DASH}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{organic ? organic.nContent : DASH}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">
                        {organic ? organic.intervalYears : DASH}
                        {organicExtra > 0 && <span className="ml-1 text-[10px] text-gold-600">+{organicExtra} more</span>}
                      </td>
                      {synth.map((f, si) => (
                        <Fragment key={si}>
                          <td className={"px-2.5 py-2 text-ink " + (si === 0 ? "border-l border-line/60" : "")}>
                            {f?.fertilizerName ?? DASH}
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-muted">{f ? f.massT : DASH}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-muted">
                            {f ? f.nContent : DASH}
                            {si === 2 && synthExtra > 0 && <span className="ml-1 text-[10px] text-gold-600">+{synthExtra} more</span>}
                          </td>
                        </Fragment>
                      ))}
                      <td className="border-l border-line/60 px-2.5 py-2 text-right tabular-nums text-muted">{a.dieselL.toLocaleString()}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{a.gasolineL.toLocaleString()}</td>
                      <td className="border-l border-line/60 px-2.5 py-2 text-right tabular-nums text-muted">{a.residueBurntKg.toLocaleString()}</td>
                      <td className="border-l border-line/60 px-2.5 py-2 text-right tabular-nums text-muted">{a.nfixDryMatterT}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{a.nfixNContent}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {recordActivityDataAction && (
        <Card className="p-4">
          <h3 className="mb-2 text-[12.5px] font-bold text-pine-700">Record activity data</h3>
          <div className="flex flex-wrap gap-3">
            {sheets.map((s) => (
              <div key={s.farmId} className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                <span className="text-[12px] font-medium text-ink">{s.name}</span>
                <ActivityDataForm farmId={s.farmId} fertilizers={fertilizers} action={recordActivityDataAction} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Baseline / Project Emissions ───────────────────────── */

function EmissionsWideTable({ scenario, sheets }: { scenario: "BSL" | "PR"; sheets: FarmSheet[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-4 py-2.5">
        <h3 className="text-[13.5px] font-bold text-pine-700">
          {scenario === "BSL" ? "Baseline Emissions" : "Project Emissions"}
        </h3>
        <p className="mt-0.5 font-mono text-[11px] text-faint">
          ▶ Soil N₂O approach = QA3 → soil N₂O (fertilizer + N-fixing) IS COUNTED on this sheet (QA3 default-factor).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-[12px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[9.5px] uppercase tracking-wide text-faint">
              {th("Farm / unit")}
              {th("Year")}
              {th("Area (ha)", "text-right")}
              {th("FSN (t N)", "text-right")}
              {th("FON (t N)", "text-right")}
              {th("N2O direct (tCO2e/ha)", "text-right")}
              {th("N2O volat (tCO2e)", "text-right")}
              {th("N2O leach (tCO2e)", "text-right")}
              {th("N2O indirect (tCO2e/ha)", "text-right")}
              {th("N2O fert (tCO2e/ha)", "text-right")}
              {th("CO2 fuel (tCO2e/ha)", "text-right")}
              {th("N2O burn (tCO2e/ha)", "text-right")}
              {th("N2O Nfix (tCO2e/ha)", "text-right")}
              {th("TOTAL (tCO2e/ha)", "text-right")}
              {th("TOTAL (tCO2e)", "text-right")}
            </tr>
          </thead>
          <tbody>
            {sheets.map((s) => {
              const rows = scenario === "BSL" ? s.bslRows : s.prRows;
              const skipReason = scenario === "BSL" ? s.bslSkipReason : s.prSkipReason;
              if (rows.length === 0) {
                return (
                  <tr key={s.farmId} className="border-t border-line">
                    <td className="px-2.5 py-2 font-semibold text-ink">{s.name}</td>
                    <td colSpan={14} className="px-2.5 py-2 text-[11.5px] text-faint">
                      Not computed{skipReason ? ` — ${skipReason}` : ""}.
                    </td>
                  </tr>
                );
              }
              return rows.map(({ activity: a, emissions: e }, i) => (
                <tr key={`${s.farmId}-${i}`} className="border-t border-line">
                  {i === 0 ? (
                    <td rowSpan={rows.length} className="border-r border-line/60 px-2.5 py-2 align-top font-semibold text-ink">
                      {s.name}
                    </td>
                  ) : null}
                  <td className="px-2.5 py-2 tabular-nums text-muted">{a.year}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{a.areaHa}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(e.fsnTN, 3)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(e.fonTN, 3)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmt(e.n2oDirect)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(e.n2oVolatTco2e)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(e.n2oLeachTco2e)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmt(e.n2oIndirect)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-medium text-ink">{fmt(e.n2oDirect + e.n2oIndirect)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmt(e.co2Fuel)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmt(e.n2oBurn)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmt(e.n2oNfix)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-pine-700">{fmt(e.totalPerHa)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-pine-700">{fmt(e.total)}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ───────────────────────── Net Reductions ───────────────────────── */

function NetReductionsTab({ sheets }: { sheets: FarmSheet[] }) {
  const counted = sheets.filter((s) => s.reduction);
  const totalArea = counted.reduce((sum, s) => sum + s.pr!.activity.areaHa, 0);
  const totalGross = counted.reduce((sum, s) => sum + s.reduction!.total, 0);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-4 py-2.5">
        <h3 className="text-[13.5px] font-bold text-pine-700">Net Reductions</h3>
        <p className="mt-0.5 font-mono text-[11px] text-faint">
          Emission reductions = Baseline (3-yr avg, tCO2e/ha) − Project (tCO2e/ha), applied to project area. Leakage
          placeholder = 0 here (allocated at Project Summary level instead — see the Leakage sheet).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-[12.5px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              {th("Farm / unit")}
              {th("Project area (ha)", "text-right")}
              {th("Baseline (tCO2e/ha)", "text-right")}
              {th("Project (tCO2e/ha)", "text-right")}
              {th("Δ per ha (tCO2e/ha)", "text-right")}
              {th("Gross ERR (tCO2e)", "text-right")}
              {th("Leakage (tCO2e)", "text-right")}
              {th("Net ERR (tCO2e)", "text-right")}
              {th("Δ CO2 fuel (tCO2e/ha)", "text-right")}
              {th("Δ N2O fert (tCO2e/ha)", "text-right")}
            </tr>
          </thead>
          <tbody>
            {sheets.map((s) => (
              <tr key={s.farmId} className="border-t border-line">
                <td className="px-2.5 py-2 text-ink">{s.name}</td>
                {s.reduction ? (
                  <>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{s.pr!.activity.areaHa}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(s.bsl!.emissions.totalPerHa)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(s.pr!.emissions.totalPerHa)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-sage-700">{fmt(s.reduction.perHa)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-pine-700">{fmt(s.reduction.total)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmt(0)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-pine-700">{fmt(s.reduction.total)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">
                      {fmt(s.bsl!.emissions.co2Fuel - s.pr!.emissions.co2Fuel)}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">
                      {fmt(
                        s.bsl!.emissions.n2oDirect +
                          s.bsl!.emissions.n2oIndirect -
                          (s.pr!.emissions.n2oDirect + s.pr!.emissions.n2oIndirect),
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={9} className="px-2.5 py-2 text-[12px] text-faint">
                    {s.bslSkipReason ?? s.prSkipReason}
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 border-pine-600 bg-pine-50 font-semibold">
              <td className="px-2.5 py-2 text-pine-700">TOTAL</td>
              <td className="px-2.5 py-2 text-right tabular-nums text-pine-700">{totalArea.toFixed(2)}</td>
              <td colSpan={3} />
              <td className="px-2.5 py-2 text-right tabular-nums text-pine-700">{totalGross.toFixed(2)}</td>
              <td />
              <td className="px-2.5 py-2 text-right tabular-nums text-pine-700">{totalGross.toFixed(2)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ───────────────────────── SOC Removals (QA1) ───────────────────────── */

function SocRemovalsTab({ sheets }: { sheets: FarmSheet[] }) {
  const note = (s: FarmSheet) =>
    s.quantificationApproaches.length === 0
      ? "no plots recorded"
      : s.quantificationApproaches.every((a) => a === "QA3")
        ? "not implemented — needs the DNDC/DayCent model-run pathway (Dave's recalibrate_model / ingest_model_results)"
        : `plots recorded under ${s.quantificationApproaches.join(", ")} — not implemented`;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13.5px] font-bold text-pine-700">SOC Removals — Quantification Approach 1 (Measure &amp; Model)</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            Hybrid model: soil-organic-carbon removals via a calibrated/validated model (per VMD0053). Eq 4/5 and 40
            are <b>not implemented</b> in this calculator — it only computes Approach 3 (default factors).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead>
              <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                {th("Farm / unit")}
                {th("Area (ha)", "text-right")}
                {th("Initial SOC (tC/ha, t=0)", "text-right")}
                {th("ΔSOC baseline (tCO2e/ha)", "text-right")}
                {th("ΔSOC project (tCO2e/ha)", "text-right")}
                {th("Net removal (tCO2e/ha)", "text-right")}
                {th("Model UNC deduction", "text-right")}
                {th("Net removal after UNC (/ha)", "text-right")}
                {th("Net removals (tCO2e)", "text-right")}
                {th("Note")}
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.farmId} className="border-t border-line">
                  <td className="px-2.5 py-2 text-ink">{s.name}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{s.totalAreaHa}</td>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <td key={i} className="px-2.5 py-2 text-right tabular-nums text-faint">{DASH}</td>
                  ))}
                  <td className="px-2.5 py-2 text-[11.5px] text-faint">{note(s)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-pine-600 bg-pine-50 font-semibold">
                <td className="px-2.5 py-2 text-pine-700">TOTAL SOC removals</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-pine-700">
                  {sheets.reduce((s, f) => s + f.totalAreaHa, 0).toFixed(2)}
                </td>
                <td colSpan={8} />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13.5px] font-bold text-pine-700">Modeled soil N₂O (QA1)</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            Populate ONLY if &quot;Soil N2O approach&quot; = QA1 (else N₂O is computed by QA3 on the emission sheets).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead>
              <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                {th("Farm / unit")}
                {th("Area (ha)", "text-right")}
                {th("Modeled N2O baseline (tCO2e/ha)", "text-right")}
                {th("Modeled N2O project (tCO2e/ha)", "text-right")}
                {th("N2O reduction (tCO2e/ha)", "text-right")}
                {th("Model UNC deduction", "text-right")}
                {th("Net reduction after UNC (/ha)", "text-right")}
                {th("Net N2O reduction (tCO2e)", "text-right")}
                {th("Note")}
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.farmId} className="border-t border-line">
                  <td className="px-2.5 py-2 text-ink">{s.name}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-muted">{s.totalAreaHa}</td>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <td key={i} className="px-2.5 py-2 text-right tabular-nums text-faint">{DASH}</td>
                  ))}
                  <td className="px-2.5 py-2 text-[11.5px] text-faint">
                    Baseline − project soil N₂O from the model — not implemented (QA3 default factors are used instead;
                    see Baseline/Project Emissions).
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-pine-600 bg-pine-50 font-semibold">
                <td colSpan={9} className="px-2.5 py-2 text-pine-700">TOTAL N₂O reductions — not implemented</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────── Leakage ───────────────────────── */

const LEAKAGE_COMPONENTS: Array<{ code: LeakageEntry["component"]; label: string; justification: string }> = [
  { code: "8.4.2", label: "8.4.2 · Livestock displacement (VMD0054, eq 36)", justification: "Reductions. 0 if no livestock displaced (document)." },
  { code: "8.4.3", label: "8.4.3 · Production declines (foregone production)", justification: "Reductions. Assess if yield drops vs baseline; net land conversion only." },
  { code: "8.4.4", label: "8.4.4 · Diversion of biomass residues from energy (CDM TOOL16)", justification: "Reductions. 0 unless residues had a baseline energy use." },
];

function LeakageTab({ sheets, manualLeakage }: { sheets: FarmSheet[]; manualLeakage: LeakageEntry[] }) {
  const knownAuto = sheets.filter((s) => s.leakage841 && !s.leakage841.carbonContentMissing);
  const anyUnknown = sheets.some((s) => s.leakage841?.carbonContentMissing);
  const autoTotal = knownAuto.reduce((s, f) => s + f.leakage841!.leakageTco2e, 0);
  const manualTotal = manualLeakage.reduce((s, l) => s + l.leakageTco2e, 0);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13.5px] font-bold text-pine-700">8.4.1 · New/additional organic amendments (eq 33)</h3>
          <p className="mt-0.5 font-mono text-[11px] text-faint">
            LE = MAX(0, additional mass) × C-content × 0.12 × 44/12 — computed automatically from activity data, one
            row per farm
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead>
              <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                {th("Farm / unit")}
                {th("Project OA (t/yr)", "text-right")}
                {th("Baseline OA (t/yr)", "text-right")}
                {th("Additional (t/yr)", "text-right")}
                {th("C content (tC/t)", "text-right")}
                {th("Exempt?")}
                {th("Leakage LE_OA (tCO2e)", "text-right")}
                {th("Note")}
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.farmId} className="border-t border-line">
                  <td className="px-2.5 py-2 text-ink">{s.name}</td>
                  {s.leakage841 ? (
                    <>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{s.leakage841.projectOrganicMassT}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{s.leakage841.baselineOrganicMassT}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">{s.leakage841.additionalMassT}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums text-muted">
                        {s.leakage841.carbonContentMissing ? DASH : (s.leakage841.carbonContent ?? DASH)}
                      </td>
                      <td className="px-2.5 py-2 text-muted">{DASH}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-earth-600">
                        {s.leakage841.carbonContentMissing ? "unknown" : s.leakage841.leakageTco2e.toFixed(4)}
                      </td>
                      <td className="px-2.5 py-2 text-[11px] text-faint">
                        {s.leakage841.carbonContentMissing
                          ? "carbon content not lab-confirmed — leakage unknown, not zero"
                          : s.leakage841.additionalMassT === 0
                            ? "no additional organic mass vs baseline"
                            : ""}
                      </td>
                    </>
                  ) : (
                    <td colSpan={7} className="px-2.5 py-2 text-[12px] text-faint">needs both a baseline and a project-year row</td>
                  )}
                </tr>
              ))}
              <tr className="border-t-2 border-pine-600 bg-pine-50 font-semibold">
                <td className="px-2.5 py-2 text-pine-700">Σ 8.4.1</td>
                <td colSpan={5} />
                <td className="px-2.5 py-2 text-right tabular-nums text-pine-700">
                  {autoTotal.toFixed(4)}
                  {anyUnknown && <span className="ml-1 text-[10px] font-normal text-gold-600">+ unknown</span>}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13.5px] font-bold text-pine-700">Other leakage components</h3>
          <p className="mt-0.5 text-[12px] text-muted">Entered with justification (default 0).</p>
        </div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              {th("Component")}
              {th("Leakage (tCO2e)", "text-right")}
              {th("Allocated to / justification")}
            </tr>
          </thead>
          <tbody>
            {LEAKAGE_COMPONENTS.map((c) => {
              const entries = manualLeakage.filter((l) => l.component === c.code);
              const sum = entries.reduce((s, l) => s + l.leakageTco2e, 0);
              return (
                <tr key={c.code} className="border-t border-line">
                  <td className="px-2.5 py-2 text-ink">{c.label}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-medium text-ink">{sum.toFixed(4)}</td>
                  <td className="px-2.5 py-2 text-[11.5px] text-muted">
                    {entries.length > 0
                      ? entries.map((e) => e.justification ?? "no justification recorded").join(" · ")
                      : c.justification}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13.5px] font-bold text-pine-700">Totals (allocated per eq 39 / eq 42)</h3>
        </div>
        <dl className="divide-y divide-line">
          <div className="flex justify-between px-4 py-2.5 text-[13px]">
            <dt className="text-muted">Leakage allocated to REDUCTIONS</dt>
            <dd className="text-right">
              <span className="font-mono font-bold text-ink">{manualTotal.toFixed(4)} tCO₂e</span>
              <span className="ml-2 text-[11px] text-faint">Livestock + production declines + biomass diversion.</span>
            </dd>
          </div>
          <div className="flex justify-between px-4 py-2.5 text-[13px]">
            <dt className="text-muted">Leakage allocated to REMOVALS</dt>
            <dd className="text-right">
              <span className="font-mono font-bold text-ink">
                {autoTotal.toFixed(4)} tCO₂e{anyUnknown && " + unknown"}
              </span>
              <span className="ml-2 text-[11px] text-faint">Organic-amendment leakage (eq 33) — offsets SOC removals.</span>
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

/* ───────────────────────── Project Summary (VVB) ───────────────────────── */

function SummaryTab({
  project,
  sheets,
  manualLeakage,
}: {
  project: Project;
  sheets: FarmSheet[];
  manualLeakage: LeakageEntry[];
}) {
  const counted = sheets.filter((s) => s.reduction);
  const skipped = sheets.filter((s) => !s.reduction);

  const totalBaseline = round2(counted.reduce((sum, s) => sum + s.bsl!.emissions.totalPerHa * s.pr!.activity.areaHa, 0));
  const totalProject = round2(counted.reduce((sum, s) => sum + s.pr!.emissions.totalPerHa * s.pr!.activity.areaHa, 0));
  const totalReduction = round2(counted.reduce((sum, s) => sum + s.reduction!.total, 0));
  const totalAreaHa = round2(counted.reduce((sum, s) => sum + s.pr!.activity.areaHa, 0));

  // eq 38: Net = (ER − LK_ER) + (Removals − LK_removals). Per the source
  // workbook's own Leakage sheet: §8.4.1 (organic-amendment leakage, eq 33)
  // is allocated to REMOVALS, not reductions; only §8.4.2-8.4.4 (manually
  // justified) are allocated to reductions. This calculator has no
  // SOC/QA1 removals pathway (see the SOC Removals tab), so Removals = 0
  // and LK_removals has nothing to net against yet — it is shown, not
  // subtracted, until that pathway exists.
  const knownAutoLeakage = sheets.filter((s) => s.leakage841 && !s.leakage841.carbonContentMissing);
  const lkRemovals = round2(knownAutoLeakage.reduce((sum, s) => sum + s.leakage841!.leakageTco2e, 0));
  const lkReductions = round2(manualLeakage.reduce((sum, l) => sum + l.leakageTco2e, 0));
  const netReduction = round2(totalReduction - lkReductions);

  return (
    <Card className="overflow-hidden border-pine-500/30">
      <div className="border-b border-line bg-pine-50 px-5 py-3">
        <h2 className="text-sm font-semibold text-pine-700">Project Summary (VVB) · {project.name}</h2>
        <p className="font-mono text-[11px] text-faint">
          {counted.length}/{sheets.length} farms counted · {project.methodology} · eq 38: Net = (ER − LK_ER) + (Removals − LK_removals)
        </p>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-3 md:grid-cols-6">
        <BigStat label="Area" value={totalAreaHa} unit="ha" />
        <BigStat label="Baseline (ER_bsl)" value={totalBaseline} unit="tCO₂e" />
        <BigStat label="Project (ER_wp)" value={totalProject} unit="tCO₂e" />
        <BigStat label="Reduction (ER)" value={totalReduction} unit="tCO₂e" tone="sage" />
        <BigStat label="Leakage (LK_ER)" value={lkReductions} unit="tCO₂e · §8.4.2-4" tone="earth" />
        <BigStat label="Net (VCU est.)" value={netReduction} unit="tCO₂e · pre-verification" tone="gold" hero />
      </div>

      <div className="border-t border-line px-5 py-3">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              <th className="py-1 font-semibold">Farm</th>
              <th className="py-1 text-right font-semibold">Area (ha)</th>
              <th className="py-1 text-right font-semibold">Reduction (tCO₂e)</th>
              <th className="py-1 text-right font-semibold">§8.4.1 leakage (→ removals)</th>
            </tr>
          </thead>
          <tbody>
            {counted.map((s) => (
              <tr key={s.farmId} className="border-t border-line">
                <td className="py-1.5 text-ink">{s.name}</td>
                <td className="py-1.5 text-right tabular-nums text-muted">{s.pr!.activity.areaHa}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-pine-700">{s.reduction!.total.toFixed(4)}</td>
                <td className="py-1.5 text-right tabular-nums text-earth-600">
                  {s.leakage841?.carbonContentMissing ? "unknown" : (s.leakage841?.leakageTco2e ?? 0).toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {skipped.length > 0 && (
          <div className="mt-3 space-y-1">
            {skipped.map((s) => (
              <p key={s.farmId} className="rounded-lg bg-gold-200/30 px-3 py-1.5 text-[11.5px] text-earth-600">
                <b>{s.name}</b> excluded from the total — {s.bslSkipReason ?? s.prSkipReason}. Not estimated.
              </p>
            ))}
          </div>
        )}

        <p className="mt-2 font-mono text-[10.5px] text-faint">
          Net removals — not shown: this calculator has no SOC/QA1 removals pathway (see SOC Removals tab), so
          leakage allocated to removals ({lkRemovals.toFixed(4)}{knownAutoLeakage.length < sheets.filter((s) => s.leakage841).length ? " + unknown" : ""}{" "}
          tCO₂e) has nothing to net against yet.
        </p>
      </div>
    </Card>
  );
}

function BigStat({
  label,
  value,
  unit,
  tone,
  hero,
}: {
  label: string;
  value: number;
  unit: string;
  tone?: "sage" | "gold" | "earth";
  hero?: boolean;
}) {
  return (
    <div className={hero ? "sm:col-span-3 md:col-span-2" : ""}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p
        className={
          (hero ? "mt-1 text-4xl" : "mt-1 text-2xl") +
          " font-bold tabular-nums " +
          (tone === "sage"
            ? "text-sage-600"
            : tone === "gold"
              ? "text-gold-600"
              : tone === "earth"
                ? "text-earth-600"
                : "text-pine-700")
        }
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 font-mono text-[10.5px] text-faint">{unit}</p>
    </div>
  );
}

/* ───────────────────────── Index ───────────────────────── */

const INDEX_ROWS: Array<[string, string, string, string, string, string]> = [
  ["A_i", "Area of quantification unit i", "ha", "6,18,21-24", "Cropped area of the farm/plot in the given year.", "Project records / GIS"],
  ["FFC_j", "Fossil fuel consumption (type j)", "L/yr", "7", "Litres of diesel or gasoline combusted.", "Fuel invoices or Machinery-Diesel sheet"],
  ["EF_CO2,j", "Emission factor, fuel j", "t CO2e/L", "7", "CO2e released per litre combusted.", "IPCC 2019 Vol.2 Ch.3"],
  ["M_SF", "Mass of synthetic fertilizer SF", "t", "19", "Tonnes of each synthetic fertilizer product applied.", "Fertilizer invoices / declaration"],
  ["NC_SF", "N content of synthetic fert SF", "t N/t", "19", "Nitrogen fraction of the product.", "Manufacturer spec / Fertilizer Library"],
  ["M_OF", "Mass of organic fertilizer OF", "t", "20", "Tonnes of compost/manure applied (m³ × density).", "Invoices / declaration"],
  ["NC_OF", "N content of organic fert OF", "t N/t", "20", "Nitrogen fraction (confirm by lab analysis).", "Lab / Fertilizer Library"],
  ["Interval", "Organic application interval", "yr", "20", "Years between organic applications; annualizes mass (e.g. once/10 yr → ÷10).", "Farm practice"],
  ["FSN", "Synthetic N applied", "t N", "18,19,22,23", "Σ M_SF × NC_SF.", "Calculated"],
  ["FON", "Organic N applied (annualized)", "t N", "18,20,22,23", "(M_OF / Interval) × NC_OF.", "Calculated"],
  ["EF_N_direct", "Direct N2O emission factor", "t N2O-N/t N", "18,24", "Direct N2O per tonne N applied; climate & conservativeness dependent.", "IPCC 2019 Table 11.1"],
  ["Frac_GASF", "Synthetic N volatilized fraction", "-", "22", "Share of synthetic N lost as NH3/NOx.", "IPCC 2019 Table 11.3"],
  ["Frac_GASM", "Organic N volatilized fraction", "-", "22", "Share of organic N lost as NH3/NOx.", "IPCC 2019 Table 11.3"],
  ["EF_N_volat", "N2O EF, atmospheric deposition", "t N2O-N/t N", "22", "EF4.", "IPCC 2019 Table 11.3"],
  ["Frac_LEACH", "N leached/runoff fraction", "-", "23", "Share of N lost to leaching/runoff (0 in dry, non-irrigated).", "IPCC 2019 Table 11.3"],
  ["EF_N_leach", "N2O EF, leaching/runoff", "t N2O-N/t N", "23", "EF5.", "IPCC 2019 Table 11.3"],
  ["GWP_N2O", "Global warming potential, N2O", "t CO2e/t N2O", "18,22-24", "265 (AR5).", "IPCC AR5 (2013)"],
  ["44/28", "N2O-N → N2O conversion", "-", "all N2O", "Molar mass ratio.", "Stoichiometry"],
  ["MB_c", "Mass of residue burnt", "kg", "32", "Dry biomass of residue type c burnt.", "Field records"],
  ["Cf", "Combustion factor", "-", "32", "Proportion of biomass actually burnt.", "IPCC 2019 Table 2.6"],
  ["EF_c,N2O", "N2O EF, residue burning", "g N2O/kg d.m.", "32", "N2O per kg dry matter burnt.", "IPCC 2019 Table 2.5"],
  ["F_CR (Nfix)", "N in N-fixing crop residue", "t N", "24,25", "Dry matter × N fraction of N-fixing species returned to soil.", "Field records / IPCC 2019 Table 11.1a"],
  ["N2O_fert", "N2O from fertilizer", "t CO2e/ha", "17", "Direct + indirect.", "Calculated"],
  ["CO2_ff", "CO2 from fossil fuel", "t CO2e/ha", "6", "Areal mean fuel CO2.", "Calculated"],
  ["Net ERR", "Net emission reductions", "t CO2e/yr", "—", "(Baseline − Project) × area − leakage.", "Calculated"],
];

function IndexTab() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-4 py-2.5">
        <h3 className="text-[13.5px] font-bold text-pine-700">Index — Variables &amp; Parameters</h3>
        <p className="mt-0.5 text-[12px] text-muted">
          Every symbol used in the engine, its unit, the equation(s) it appears in, and its source.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
              {th("Symbol")}
              {th("Name")}
              {th("Unit")}
              {th("Equations")}
              {th("Description")}
              {th("Source")}
            </tr>
          </thead>
          <tbody>
            {INDEX_ROWS.map(([symbol, name, unit, eqs, desc, source]) => (
              <tr key={symbol} className="border-t border-line">
                <td className="px-2.5 py-2 font-mono font-semibold text-pine-700">{symbol}</td>
                <td className="px-2.5 py-2 text-ink">{name}</td>
                <td className="px-2.5 py-2 font-mono text-[11px] text-muted">{unit}</td>
                <td className="px-2.5 py-2 font-mono text-[11px] text-muted">{eqs}</td>
                <td className="px-2.5 py-2 text-muted">{desc}</td>
                <td className="px-2.5 py-2 text-[11px] text-faint">{source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
