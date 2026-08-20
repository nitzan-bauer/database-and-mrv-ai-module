import "server-only";

export interface MarketScanProject {
  registry: string;
  methodology: string | null;
  projectName: string;
  location: string | null;
  creditsIssuedNote: string;
  sourceUrl: string;
  discoveredAt: string;
}

export interface MarketScanDeal {
  registry: string;
  methodology: string | null;
  projectOrSeller: string;
  priceNote: string;
  brief: string;
  sourceUrl: string;
  discoveredAt: string;
}

/** What John's monthly project scan (0080) has actually found — real rows only, newest first. */
export async function listMarketScanProjects(limit = 20): Promise<MarketScanProject[]> {
  const { query } = await import("../db");
  const rows = await query<{
    registry: string;
    methodology: string | null;
    project_name: string;
    location: string | null;
    credits_issued_note: string;
    source_url: string;
    discovered_at: string;
  }>(
    `SELECT registry, methodology, project_name, location, credits_issued_note, source_url, discovered_at::text
       FROM mrv.market_scan_projects
      ORDER BY discovered_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    registry: r.registry,
    methodology: r.methodology,
    projectName: r.project_name,
    location: r.location,
    creditsIssuedNote: r.credits_issued_note,
    sourceUrl: r.source_url,
    discoveredAt: r.discovered_at,
  }));
}

/** What John's monthly market/price scan (0080) has actually found — real rows only, newest first. */
export async function listMarketScanDeals(limit = 20): Promise<MarketScanDeal[]> {
  const { query } = await import("../db");
  const rows = await query<{
    registry: string;
    methodology: string | null;
    project_or_seller: string;
    price_note: string;
    brief: string;
    source_url: string;
    discovered_at: string;
  }>(
    `SELECT registry, methodology, project_or_seller, price_note, brief, source_url, discovered_at::text
       FROM mrv.market_scan_deals
      ORDER BY discovered_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    registry: r.registry,
    methodology: r.methodology,
    projectOrSeller: r.project_or_seller,
    priceNote: r.price_note,
    brief: r.brief,
    sourceUrl: r.source_url,
    discoveredAt: r.discovered_at,
  }));
}
