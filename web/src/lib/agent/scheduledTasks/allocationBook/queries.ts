import "server-only";

/**
 * Shared data-loading for the Allocation Book (Chapters 1 & 2 — the
 * Potential vector). Split out of the old johnAllocationReport.ts so the
 * new reconciliation gate (chapter2.ts) and the negative-balance gate
 * (negativeBalance.ts) can both work off exactly the same rows the
 * report renders, instead of re-deriving them independently and risking
 * the two silently drifting apart.
 */

export interface FarmProjectRow {
  farmId: string;
  farmName: string;
  projectId: string;
  plotType: string | null;
  plotCount: number;
  areaHa: number;
  agriInputs: string | null;
  farmPotential: number;
  farmerSharePct: number;
  buyerCredits: number;
  buyerValue: number;
  buyerNames: string | null;
  farmCredits: number;
  farmValue: number;
  cnCredits: number;
  cnValue: number;
  /** True if any allocation_register row feeding this farm's buyerCredits is test data — the report tags the row "(TEST)" rather than silently blending it into a real total. */
  includesTestData: boolean;
}

export interface DealRow {
  projectId: string;
  dealType: string;
  farmId: string | null;
  farmName: string;
  buyerName: string;
  credits: number;
  value: number;
  signedAt: string | null;
  createdAt: string;
  transactionNo: string | null;
  cnPct: number;
  isTestData: boolean;
}

export interface ProjectLevelDeal {
  projectId: string;
  credits: number;
  value: number;
  buyerNames: string | null;
}

export interface PotentialData {
  farmRows: FarmProjectRow[];
  dealRows: DealRow[];
  projectLevelDeals: Map<string, ProjectLevelDeal>; // keyed by short project name
  plotTypeByProjectId: Map<string, string>;
  priceByProject: Map<string, number>;
  rateByPlotType: Map<string, number>;
  projectOrder: string[];
  byProject: Map<string, FarmProjectRow[]>;
  dealsByProject: Map<string, DealRow[]>;
}

function buyerLabel(names: (string | null)[] | null | undefined): string | null {
  const distinct = [...new Set((names ?? []).filter((n): n is string => Boolean(n)))];
  return distinct.length ? distinct.join(", ") : null;
}

/** Nitzan's own short names for the two live projects (2026-08-30). */
export function shortProjectName(plotType: string | null): string {
  if (plotType === "young_orchard" || plotType === "mature_orchard") return "fruit-plantations";
  if (plotType === "open_field") return "open-field";
  return "other";
}

export async function loadPotentialData(): Promise<PotentialData> {
  const { query } = await import("../../../db");
  const { listFarmNamesByIds, listSaasProjects } = await import("../../../saas/saasClient");

  const perFarm = await query<{
    farm_id: string;
    project_id: string;
    plot_type: string | null;
    plot_count: string;
    area_ha: string;
    farm_potential: string;
    sold_credits: string | null;
    sold_value: string | null;
    buyer_names: (string | null)[] | null;
    agri_inputs: (string | null)[] | null;
    farmer_share_pct: string | null;
    has_test_data: boolean;
  }>(
    `SELECT y.farm_id, y.project_id, y.plot_type,
            COUNT(DISTINCT y.plot_id) AS plot_count, SUM(y.area_ha) AS area_ha,
            SUM(y.estimated_credits) AS farm_potential,
            ar.sold_credits, ar.sold_value, ar.buyer_names, ar.agri_inputs, ar.has_test_data,
            (SELECT farmer_share_pct FROM mrv.farm_participation_terms t
              WHERE t.farm_id = y.farm_id AND t.effective_date <= CURRENT_DATE
              ORDER BY t.effective_date DESC LIMIT 1) AS farmer_share_pct
       FROM mrv.credit_yield_estimates y
       LEFT JOIN LATERAL (
         SELECT SUM(a.credits_tco2e_potential) AS sold_credits, SUM(a.cost_usd) AS sold_value,
                array_agg(DISTINCT a.buyer_company_name) AS buyer_names,
                array_agg(DISTINCT a.agri_input) FILTER (WHERE a.deal_type = 'agri_inputs' AND a.agri_input IS NOT NULL) AS agri_inputs,
                bool_or(a.is_test_data) AS has_test_data
           FROM mrv.allocation_register a
          WHERE a.farm_id = y.farm_id AND a.project_id = y.project_id AND a.status <> 'released'
       ) ar ON true
      WHERE y.method = 'rate_table'
      GROUP BY y.farm_id, y.project_id, y.plot_type, ar.sold_credits, ar.sold_value, ar.buyer_names, ar.agri_inputs, ar.has_test_data`,
  );

  const deals = await query<{
    project_id: string;
    deal_type: string;
    buyer_company_name: string | null;
    credits_tco2e_potential: string;
    cost_usd: string;
    signed_at: string | null;
    created_at: string;
    transaction_no: string | null;
    farm_id: string | null;
    is_test_data: boolean;
  }>(
    `SELECT project_id, deal_type, buyer_company_name, credits_tco2e_potential, cost_usd, signed_at, created_at, transaction_no, farm_id, is_test_data
       FROM mrv.allocation_register
      WHERE status <> 'released'
      ORDER BY project_id, signed_at NULLS LAST, created_at`,
  );

  const dealFarmIds = [...new Set(deals.map((d) => d.farm_id).filter((id): id is string => Boolean(id)))];
  const sharePctByFarm = new Map<string, number>();
  if (dealFarmIds.length) {
    const terms = await query<{ farm_id: string; farmer_share_pct: string }>(
      `SELECT DISTINCT ON (farm_id) farm_id, farmer_share_pct
         FROM mrv.farm_participation_terms
        WHERE farm_id = ANY($1) AND effective_date <= CURRENT_DATE
        ORDER BY farm_id, effective_date DESC`,
      [dealFarmIds],
    );
    for (const t of terms) sharePctByFarm.set(t.farm_id, Number(t.farmer_share_pct));
  }
  function cnPctFor(dealType: string, farmId: string | null): number {
    if (dealType === "project_funding") return 1; // 100% CarboNature — the double-counting contract fix.
    if (dealType === "agri_inputs" && farmId) return 1 - (sharePctByFarm.get(farmId) ?? 0.5);
    return 0.5;
  }

  const projectLevelDealsRaw = await query<{
    project_id: string;
    credits: string | null;
    value: string | null;
    buyer_names: (string | null)[] | null;
  }>(
    `SELECT project_id, SUM(credits_tco2e_potential) AS credits, SUM(cost_usd) AS value,
            array_agg(DISTINCT buyer_company_name) AS buyer_names
       FROM mrv.allocation_register
      WHERE farm_id IS NULL AND status <> 'released'
      GROUP BY project_id`,
  );

  const defaults = await query<{ project_id: string; default_plot_type: string }>(
    `SELECT project_id, default_plot_type FROM mrv.project_plot_type_defaults`,
  );
  const plotTypeByProjectId = new Map(defaults.map((d) => [d.project_id, d.default_plot_type]));
  const yieldRates = await query<{ plot_type: string; rate_per_ha: string }>(`SELECT plot_type, rate_per_ha FROM mrv.credit_yield_rate_table`);
  const rateByPlotType = new Map(yieldRates.map((r) => [r.plot_type, Number(r.rate_per_ha)]));

  const farmIds = [...new Set([...perFarm.map((r) => r.farm_id), ...dealFarmIds])];
  const [farmNames, projects] = await Promise.all([listFarmNamesByIds(farmIds), listSaasProjects()]);
  const priceByProject = new Map(projects.map((p) => [p.id, Number(p.credit_price_usd ?? 0)]));

  const farmRows: FarmProjectRow[] = perFarm.map((r) => {
    const pct = r.farmer_share_pct !== null ? Number(r.farmer_share_pct) : 0.5;
    const buyerCredits = Number(r.sold_credits ?? 0);
    const buyerValue = Number(r.sold_value ?? 0);
    const farmPotential = Number(r.farm_potential);
    const netPool = farmPotential - buyerCredits;
    const price = priceByProject.get(r.project_id) ?? 0;
    const farmCredits = netPool * pct;
    const cnCredits = netPool * (1 - pct);
    return {
      farmId: r.farm_id,
      farmName: farmNames.get(r.farm_id) ?? r.farm_id,
      projectId: r.project_id,
      plotType: r.plot_type,
      plotCount: Number(r.plot_count),
      areaHa: Number(r.area_ha),
      agriInputs: buyerLabel(r.agri_inputs),
      farmPotential,
      farmerSharePct: pct,
      buyerCredits,
      buyerValue,
      buyerNames: buyerLabel(r.buyer_names),
      farmCredits,
      farmValue: farmCredits * price,
      cnCredits,
      cnValue: cnCredits * price,
      includesTestData: Boolean(r.has_test_data),
    };
  });

  const dealRows: DealRow[] = deals.map((d) => ({
    projectId: d.project_id,
    dealType: d.deal_type,
    farmId: d.farm_id,
    farmName: d.farm_id ? (farmNames.get(d.farm_id) ?? d.farm_id) : "-",
    buyerName: d.buyer_company_name ?? "-",
    credits: Number(d.credits_tco2e_potential),
    value: Number(d.cost_usd),
    signedAt: d.signed_at,
    createdAt: d.created_at,
    transactionNo: d.transaction_no,
    cnPct: cnPctFor(d.deal_type, d.farm_id),
    isTestData: d.is_test_data,
  }));

  const byProject = new Map<string, FarmProjectRow[]>();
  for (const r of farmRows) {
    const key = shortProjectName(r.plotType);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(r);
  }
  const dealsByProject = new Map<string, DealRow[]>();
  for (const d of dealRows) {
    const key = shortProjectName(plotTypeByProjectId.get(d.projectId) ?? null);
    if (!dealsByProject.has(key)) dealsByProject.set(key, []);
    dealsByProject.get(key)!.push(d);
    if (!byProject.has(key)) byProject.set(key, []);
  }

  const projectLevelDeals = new Map<string, ProjectLevelDeal>();
  for (const d of projectLevelDealsRaw) {
    const key = shortProjectName(plotTypeByProjectId.get(d.project_id) ?? null);
    projectLevelDeals.set(key, {
      projectId: d.project_id,
      credits: Number(d.credits ?? 0),
      value: Number(d.value ?? 0),
      buyerNames: buyerLabel(d.buyer_names),
    });
    if (!byProject.has(key)) byProject.set(key, []);
  }

  const projectOrder = ["open-field", "fruit-plantations", "other"].filter((k) => byProject.has(k));

  return { farmRows, dealRows, projectLevelDeals, plotTypeByProjectId, priceByProject, rateByPlotType, projectOrder, byProject, dealsByProject };
}
