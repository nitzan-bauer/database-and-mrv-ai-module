import Link from "next/link";
import { listFertilizers } from "@/lib/data";
import { DATA_MODE } from "@/lib/env";
import { Card, Section } from "@/components/ui/Card";
import { DEFAULT_PARAMETERS, DRY_PARAMETERS } from "@/lib/ghg/engine";

export const dynamic = "force-dynamic";

/**
 * The GHG Calculator's Reference Hub — the workbook's README + Fixed
 * Parameters + Fertilizer Library + Equations sheets, consolidated into
 * one page that sits outside any one project's tab set (a farm's own
 * numbers live on /ghg; this page is the same for every project).
 */
export default async function GhgReferencePage() {
  const fertilizers = DATA_MODE === "db" ? await listFertilizers() : [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pine-700">GHG Calculator — Reference Hub</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Fixed parameters, the fertilizer catalog, and the VM0042 equations this calculator
            implements — the same for every project, so it lives here rather than inside any one
            project&apos;s tab set.
          </p>
        </div>
        <Link
          href="/ghg"
          className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-pine-700 hover:bg-pine-50"
        >
          ← Back to GHG Calculator
        </Link>
      </div>

      <Section
        title="Fixed Parameters"
        subtitle="mrv.ghg_parameters — VM0042 v2.2 §8.3, IPCC 2019 Refinement default factors"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ParameterSetTable label="default-v1.0 (wet)" p={DEFAULT_PARAMETERS} />
          <ParameterSetTable label="dry-v1.0 (dry)" p={DRY_PARAMETERS} />
        </div>
      </Section>

      <Section
        title="Fertilizer Library"
        subtitle={`mrv.fertilizers — ${fertilizers.length} entries · nitrogen content and class (drives Frac_GASF vs Frac_GASM, eq 22)`}
      >
        {fertilizers.length === 0 ? (
          <p className="text-[13px] text-muted">
            {DATA_MODE === "fixtures" ? "Not shown in fixtures mode." : "No fertilizers in the catalog yet."}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                  <th className="py-1.5 font-semibold">Name</th>
                  <th className="py-1.5 text-right font-semibold">N content</th>
                  <th className="py-1.5 font-semibold">Class</th>
                </tr>
              </thead>
              <tbody>
                {fertilizers.map((f) => (
                  <tr key={f.name} className="border-t border-line">
                    <td className="py-1.5 text-ink">{f.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">
                      {(f.nContent * 100).toFixed(2)}%
                    </td>
                    <td className="py-1.5 font-mono text-[11px] text-faint">{f.class}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Equations"
        subtitle="The exact equations, in the source workbook's own notation — every equation this calculator implements, and where"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-pine-700 text-left text-[11px] uppercase tracking-wide text-white">
                <th className="px-3 py-2 font-semibold">Eq</th>
                <th className="px-3 py-2 font-semibold">Formula</th>
                <th className="px-3 py-2 font-semibold">Explanation</th>
                <th className="px-3 py-2 font-semibold">Computed in</th>
              </tr>
            </thead>
            <tbody>
              {EQUATIONS.map((e) => (
                <tr key={e.eq} className={"border-b border-line " + (e.where === "not implemented" ? "opacity-60" : "")}>
                  <td className="px-3 py-2.5 align-top font-mono text-[12px] font-bold text-pine-700">{e.eq}</td>
                  <td dir="ltr" className="px-3 py-2.5 align-top text-left font-mono text-[13.5px] leading-relaxed text-ink">
                    {e.formula}
                  </td>
                  <td className="px-3 py-2.5 align-top text-ink">{e.what}</td>
                  <td className="px-3 py-2.5 align-top font-mono text-[11px] text-faint">{e.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function ParameterSetTable({
  label,
  p,
}: {
  label: string;
  p: (typeof DEFAULT_PARAMETERS);
}) {
  const rows: Array<[string, string | number]> = [
    ["Climate zone", p.climateZone],
    ["N trend", p.nTrend],
    ["Soil N₂O approach", p.soilN2OApproach],
    ["EF_CO2 diesel", p.efCo2Diesel],
    ["EF_CO2 gasoline", p.efCo2Gasoline],
    ["GWP N₂O (AR5, 100yr)", p.gwpN2O],
    ["EF_N_direct — wet", p.efNDirectWet],
    ["EF_N_direct — dry", p.efNDirectDry],
    ["EF_N_direct — low (N decreasing)", p.efNDirectLow],
    ["EF_N_direct — high (N increasing)", p.efNDirectHigh],
    ["Frac_GASF (synthetic)", p.fracGasf],
    ["Frac_GASM (organic)", p.fracGasm],
    ["EF_N_volatilisation", p.efNVolat],
    ["Frac_LEACH — wet", p.fracLeachWet],
    ["EF_N_leach", p.efNLeach],
    ["CF combustion (residue burning)", p.cfCombustion],
    ["EF_C-N2O (residue burning)", p.efCN2O],
  ];
  return (
    <Card className="p-4">
      <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-pine-700">
        {label}
      </h3>
      <dl className="space-y-1 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line/60 pb-0.5">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-mono font-medium text-ink">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const EQUATIONS: Array<{ eq: string; formula: string; what: string; where: string }> = [
  {
    eq: "6",
    formula: "CO2_ff(i,t) = Σ_j EFF(j,i,t) / A_i",
    what: "Areal mean CO₂ from fuel = total fuel CO₂ ÷ area.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "7",
    formula: "EFF(j,i,t) = FFC(j,i,t) × EF_CO2,j",
    what: "Fuel CO₂ = litres × fuel emission factor.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "16",
    formula: "N2O_soil = N2O_fert + N2O_md + N2O_Nfix",
    what: "Total soil N₂O (manure deposition N2O_md is Phase 2 — not implemented).",
    where: "engine.ts · showWorking",
  },
  {
    eq: "17",
    formula: "N2O_fert = N2O_fert,direct + N2O_fert,indirect",
    what: "Fertiliser N₂O splits into direct + indirect.",
    where: "engine.ts · showWorking",
  },
  {
    eq: "18",
    formula: "N2O_fert,direct = ((FSN+FON) × EF_N_direct × 44/28 × GWP) / A_i",
    what: "Direct N₂O from N applied, per ha.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "19",
    formula: "FSN = Σ_SF (M_SF × NC_SF)",
    what: "Synthetic N = Σ product mass × N content.",
    where: "engine.ts · nApplied",
  },
  {
    eq: "20",
    formula: "FON = Σ_OF (M_OF/Interval × NC_OF)",
    what: "Organic N, annualised over its application interval.",
    where: "engine.ts · nApplied",
  },
  {
    eq: "21",
    formula: "N2O_fert,indirect = (N2O_volat + N2O_leach) / A_i",
    what: "Indirect N₂O per ha.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "22",
    formula: "N2O_volat = [(FSN×Frac_GASF)+(FON×Frac_GASM)] × EF_N_volat × 44/28 × GWP",
    what: "Indirect N₂O from volatilised N redeposition.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "23",
    formula: "N2O_leach = (FSN+FON) × Frac_LEACH × EF_N_leach × 44/28 × GWP",
    what: "Indirect N₂O from leaching/runoff.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "24",
    formula: "N2O_Nfix = (F_CR × EF_N_direct × 44/28 × GWP) / A_i",
    what: "Direct N₂O from N-fixing crop residue returned to soil.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "25",
    formula: "F_CR = Σ_g (DM_g × N_content,g)",
    what: "N in N-fixing residue = dry matter × N fraction.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "32",
    formula: "N2O_burn = (GWP × MB × Cf × EF_c,N2O) / 1e6 / A_i",
    what: "N₂O from residue burning, per ha.",
    where: "engine.ts · computeEmissions",
  },
  {
    eq: "33",
    formula: "LE = MAX(0, M_wp − M_bsl) × C_content × 0.12 × 44/12",
    what: "§8.4.1 leakage — new/additional organic soil amendments.",
    where: "engine.ts · computeLeakage841",
  },
  {
    eq: "36",
    formula: "LK_disp,t = MAX(0, LK_t − LK_prior) / years",
    what: "§8.4.3 leakage from production declines (VMD0054) — corrected 11-Jun-2026, not populated with live data.",
    where: "not implemented",
  },
  {
    eq: "4/5",
    formula: "SOC_stock = 100 × BD_corr × depth × SOC%  →  SOC_bsl/wp,t (modeled, QA1)",
    what: "Hybrid QA1: soil-carbon stock & modelled stock change (per VMD0053).",
    where: "not implemented — QA3 only",
  },
  {
    eq: "40",
    formula: "CO2_removals = I(CO2wp) × [MAX(0,ΔCO2_wp) − MAX(0,ΔCO2_bsl)]",
    what: "SOC removals when cumulative project carbon stock change is positive.",
    where: "not implemented — QA3 only",
  },
  {
    eq: "38/41",
    formula: "Net = (ER − LK_ER) + (Removals − LK_removals)",
    what: "Net reductions + net removals, leakage allocated to each. Removals = 0 here (no QA1 SOC pathway), so Net = ER − LK_ER.",
    where: "GhgWorkbook.tsx · SummaryTab",
  },
];
