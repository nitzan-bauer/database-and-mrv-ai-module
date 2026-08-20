import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface VerraRegistryEntry {
  entryId: string;
  verraProjectId: number;
  projectName: string;
  status: string;
  description: string | null;
  modifiedDate: string | null;
  isNew: boolean;
}

export interface VerraRegistrySearch {
  totalMatching: number;
  newSinceLastCheck: number;
  entries: VerraRegistryEntry[];
}

const SEARCH_URL = "https://prod-us.api.platts.com/ci-raas-prod/raas-report-api/es/public/project/publicReportPageSearch";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Verra's real project-search API — the same one registry.verra.org's own
 * UI calls, found by watching its network traffic rather than guessed.
 * registry.verra.org itself is a client-rendered app; a plain GET there
 * returns an empty shell, which is what made fetch_public_url unable to
 * reach it. This endpoint is different: a JSON REST API that, confirmed
 * directly (a bare server-side fetch, no cookies, no login), answers with
 * real project data given only its own public front-end app key and a
 * handful of static standard-identifying headers — no headless browser
 * needed, no session to hold.
 *
 * Every match is upserted into mrv.verra_registry_snapshot, which is what
 * lets `isNew` mean something: a project seen for the first time this
 * call is new since whenever this was last run, not just "in this page
 * of results". Running this once a day is what turns that into an actual
 * daily digest of new VM0042 activity; nothing here schedules that by
 * itself yet.
 *
 * `query` does NOT filter Verra's own API call — confirmed directly that
 * its projectName column-filter only matches the project's title, not
 * its description, and the real question this exists to answer ("is
 * there a precedent with a similar scope to ours") lives in the
 * description: a project about mycorrhizal inoculant application is not
 * going to have "mycorrhizae" in its title. So the live call always
 * harvests by methodology/status alone (sorted newest-modified-first, so
 * repeated calls keep the snapshot current), and `query` instead searches
 * the accumulated snapshot's full text — which gets better the more this
 * has been run, not just this one page of results.
 */
export async function searchVerraRegistry(
  ctx: ToolContext,
  input: { methodology?: string; query?: string; status?: string; limit?: number },
): Promise<ToolResult<VerraRegistrySearch>> {
  const guard = requireDbMode("searchVerraRegistry");
  if (guard) return guard;

  const policy = await checkPolicy("search_verra_registry", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const methodology = (input.methodology ?? "VM0042").trim();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  // Harvest a wider pool than `limit` when there's a content query to run
  // over it afterward — the match might not be in the first `limit` rows
  // by recency.
  const harvestLimit = input.query?.trim() ? 100 : limit;

  const columnFilters: Record<string, { columnFilters: Array<{ filterType: string; type: string; filter: string }> }> = {
    methodologies: { columnFilters: [{ filterType: "Text", type: "contains", filter: methodology }] },
  };
  if (input.status?.trim()) {
    columnFilters.status = { columnFilters: [{ filterType: "Text", type: "contains", filter: input.status.trim() }] };
  }

  const body = JSON.stringify({
    searchFilter: {
      pagination: { start: 0, limit: harvestLimit, sortOptions: [{ sort: "modifiedDate", dir: "DESC" }] },
      filterModel: columnFilters,
    },
  });

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(SEARCH_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          language: "en",
          standardId: "150000000000001",
          standardAcronym: "VCS",
          registry: "VERRA",
          appkey: "wOKHFGuxKApQaujPSKgF",
          application: "Markit",
        },
        body,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    return fail(`searchVerraRegistry: could not reach the Verra registry API — ${e instanceof Error ? e.message : e}.`);
  }

  if (!res.ok) {
    return fail(`searchVerraRegistry: Verra's API returned ${res.status}.`);
  }

  interface RawEntity {
    id: string;
    projectId: number;
    projectName: string;
    status: string;
    projectDescription?: string | null;
    modifiedDate?: string | null;
  }
  const payload: { entities?: RawEntity[]; total?: number } = await res.json();
  const entities = payload.entities ?? [];

  const { query } = await import("../db");

  const existing = await query<{ entry_id: string }>(
    `SELECT entry_id FROM mrv.verra_registry_snapshot WHERE entry_id = ANY($1::text[])`,
    [entities.map((e) => e.id)],
  );
  const existingIds = new Set(existing.map((r) => r.entry_id));

  let newSinceLastCheck = 0;
  for (const e of entities) {
    if (!existingIds.has(e.id)) newSinceLastCheck++;
    await query(
      `INSERT INTO mrv.verra_registry_snapshot
         (entry_id, verra_project_id, project_name, status, methodology_query, description, modified_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (entry_id) DO UPDATE SET
         status = excluded.status,
         description = excluded.description,
         modified_date = excluded.modified_date,
         last_seen_at = clock_timestamp()`,
      [e.id, e.projectId, e.projectName, e.status, methodology, e.projectDescription ?? null, e.modifiedDate ?? null],
    );
  }

  let entries: VerraRegistryEntry[];
  if (input.query?.trim()) {
    // Search the accumulated snapshot's full text, not just this batch —
    // this improves every time the corpus grows, the same reasoning as
    // research_pdd_precedents' full-text search over the local PDD corpus.
    //
    // Plain ILIKE, not tsvector/English stemming: confirmed directly that
    // Postgres's English stemmer does not conflate "mycorrhizae" (what a
    // person types) with "mycorrhizal" (what a real project description
    // says) — exactly the kind of scientific/agricultural term generic
    // stemming handles badly. A raw substring match on the query and on
    // a crude stripped root (drop a trailing -ae/-al/-s) catches both.
    const q = input.query.trim();
    const root = q.replace(/(ae|al|s)$/i, "");
    const rows = await query<{
      entry_id: string;
      verra_project_id: number;
      project_name: string;
      status: string;
      description: string | null;
      modified_date: string | null;
    }>(
      `SELECT entry_id, verra_project_id, project_name, status, description, modified_date
         FROM mrv.verra_registry_snapshot
        WHERE methodology_query = $1
          AND ($3 = '' OR status ILIKE '%' || $3 || '%')
          AND (
            (project_name || ' ' || coalesce(description, '')) ILIKE '%' || $2 || '%'
            OR (project_name || ' ' || coalesce(description, '')) ILIKE '%' || $5 || '%'
          )
        ORDER BY modified_date DESC NULLS LAST
        LIMIT $4`,
      [methodology, q, input.status?.trim() ?? "", limit, root],
    );
    entries = rows.map((r) => ({
      entryId: r.entry_id,
      verraProjectId: r.verra_project_id,
      projectName: r.project_name,
      status: r.status,
      description: r.description,
      modifiedDate: r.modified_date,
      isNew: existingIds.has(r.entry_id) === false,
    }));
  } else {
    entries = entities.slice(0, limit).map((e) => ({
      entryId: e.id,
      verraProjectId: e.projectId,
      projectName: e.projectName,
      status: e.status,
      description: e.projectDescription ?? null,
      modifiedDate: e.modifiedDate ?? null,
      isNew: !existingIds.has(e.id),
    }));
  }

  await audit(ctx, "search_verra_registry", null, {
    methodology,
    query: input.query ?? null,
    status: input.status ?? null,
    totalMatching: payload.total ?? entities.length,
    returned: entries.length,
    newSinceLastCheck,
  });

  return ok({
    totalMatching: payload.total ?? entities.length,
    newSinceLastCheck,
    entries,
  });
}
