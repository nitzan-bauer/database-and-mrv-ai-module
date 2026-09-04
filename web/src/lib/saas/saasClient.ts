import "server-only";
import { SAAS_SUPABASE_SERVICE_ROLE_KEY, SAAS_SUPABASE_URL } from "../env";

/**
 * Reads against the customer-facing SaaS data. Since Addendum 1 (one
 * physical database — MRV's own DATABASE_URL now points at the SaaS's own
 * Supabase project, mrv/crm schemas migrated alongside its public schema),
 * every table read below goes through MRV's own pooled `pg` connection
 * (db.ts's query()) as a direct SQL query against `public.*` — no network
 * hop, no PostgREST, no service-role key. Always schema-qualified
 * (`public.farms`, never bare `farms`) because this pool's search_path is
 * `mrv,public`: an unqualified name that happens to also exist in `mrv`
 * (farms, plots, projects, users all do) would silently resolve to the
 * WRONG table otherwise.
 *
 * The two Storage-backed reads at the bottom (readStorageJson/
 * readStorageObject — JSON ledgers and settings.json, not real tables)
 * still go over the Storage REST API, since Postgres has no equivalent for
 * "read this JSON file out of a bucket."
 *
 * Read-only: nothing here can write back to the SaaS database, on purpose —
 * a real PDD import has no business mutating the marketplace/onboarding
 * data.
 */

export interface SaasFarm {
  id: string;
  farm_name: string;
  company_name: string | null;
  addr_country: string;
  addr_city: string;
  cultivation_area: number | null;
  cultivation_unit: "Ha" | "Acres" | null;
  crops: string[];
  contact_first: string | null;
  contact_surname: string | null;
}

function assertConfigured(): void {
  if (!SAAS_SUPABASE_URL || !SAAS_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SAAS_SUPABASE_URL / SAAS_SUPABASE_SERVICE_ROLE_KEY are not configured.");
  }
}

const FARM_COLUMNS = "id, farm_name, company_name, addr_country, addr_city, cultivation_area, cultivation_unit, crops, contact_first, contact_surname";

/** One farm by its SaaS id, or null if it doesn't exist there. */
export async function fetchSaasFarm(saasFarmId: string): Promise<SaasFarm | null> {
  const { query } = await import("../db");
  const rows = (await query(`SELECT ${FARM_COLUMNS} FROM public.farms WHERE id = $1`, [saasFarmId])) as unknown as SaasFarm[];
  return rows[0] ?? null;
}

/**
 * Farms registered after `sinceIso` — the "new farmer since last check"
 * source for the biweekly scheduled task (Nitzan's own spec, live this
 * session). Confirmed live that farms.created_at exists on the real SaaS
 * table before writing this, the same way every other real-data claim in
 * this codebase is verified rather than assumed.
 */
export async function listSaasFarmsSince(sinceIso: string): Promise<SaasFarm[]> {
  const { query } = await import("../db");
  return (await query(`SELECT ${FARM_COLUMNS} FROM public.farms WHERE created_at > $1 ORDER BY created_at ASC`, [sinceIso])) as unknown as SaasFarm[];
}

/**
 * Read access for John's Allocation Register sync (johnAllocationSync.ts).
 * Deliberately flat, separate queries joined in JS, mirroring the exact
 * pattern carbonature-saas's own src/lib/agriDealLifecycle.ts#listAgriDeals
 * uses, rather than a single nested PostgREST embed.
 */

export interface SaasReservation {
  id: string;
  buyer_id: string;
  project_id: string | null;
  transaction_no: string | null;
  total_cost_usd: number;
  allocated_credits: number;
  application_area_ha: number;
  created_at: string;
}

export interface SaasReservationPlot {
  reservation_id: string;
  plot_id: string;
}

export interface SaasPlot {
  id: string;
  project_id: string;
  farm_id: string | null;
  credits: number;
  area_ha: number;
  /**
   * The AGRI INPUT product/practice actually reserved/purchased for this
   * plot's deal — plots.geojson.properties.reserved_agri_input (falling
   * back to the single .agri_input field, never the plural .agri_inputs
   * array). Confirmed live 2026-08-31: .agri_inputs lists EVERY input
   * option ever available/recorded for the plot — e.g. a plot reserved for
   * "Rootella-F" ($1,676) also listed "CoteN" ($13,968) in that array
   * despite the buyer never selecting or paying for it. Using the array
   * silently attributed an unpurchased input to a real deal — a real bug,
   * not a display quirk (Nitzan, 2026-08-31: "I didn't select CoteN").
   */
  agriInputs: string[];
}

interface SaasPlotRaw {
  id: string;
  project_id: string;
  farm_id: string | null;
  credits: number;
  area_ha: number;
  geojson: { properties?: { agri_input?: string | null; reserved_agri_input?: string | null } } | null;
}

function parsePlotAgriInputs(raw: SaasPlotRaw): SaasPlot {
  const props = raw.geojson?.properties;
  const reserved = props?.reserved_agri_input ?? props?.agri_input ?? null;
  const agriInputs = reserved ? [reserved] : [];
  return { id: raw.id, project_id: raw.project_id, farm_id: raw.farm_id, credits: raw.credits, area_ha: raw.area_ha, agriInputs };
}

export interface SaasContractRow {
  reservation_id: string | null;
  status: "draft" | "sent" | "signed" | "countersigned";
  signed_at: string | null;
}

export interface SaasCreditBuyer {
  profile_id: string;
  company_name: string;
}

export interface SaasProject {
  id: string;
  name: string;
  credit_price_usd: number | null;
}

/** Agri-Inputs reservations, one row per deal regardless of lifecycle state. */
export async function listAgriInputsReservations(): Promise<SaasReservation[]> {
  const { query } = await import("../db");
  return (await query(
    `SELECT id, buyer_id, project_id, transaction_no, total_cost_usd, allocated_credits, application_area_ha, created_at
       FROM public.reservations ORDER BY created_at ASC`,
  )) as unknown as SaasReservation[];
}

export async function listReservationPlots(reservationIds: string[]): Promise<SaasReservationPlot[]> {
  if (!reservationIds.length) return [];
  const { query } = await import("../db");
  return (await query(
    `SELECT reservation_id, plot_id FROM public.reservation_plots WHERE reservation_id = ANY($1::uuid[])`,
    [reservationIds],
  )) as unknown as SaasReservationPlot[];
}

export async function listPlotsByIds(plotIds: string[]): Promise<SaasPlot[]> {
  if (!plotIds.length) return [];
  const { query } = await import("../db");
  const raw = (await query(
    `SELECT id, project_id, farm_id, credits, area_ha, geojson FROM public.plots WHERE id = ANY($1::uuid[])`,
    [plotIds],
  )) as unknown as SaasPlotRaw[];
  return raw.map(parsePlotAgriInputs);
}

/** Every plot in the SaaS marketplace, not just ones already tied to a reservation — the potential estimate covers unsold plots too. */
export async function listAllSaasPlots(): Promise<SaasPlot[]> {
  const { query } = await import("../db");
  const raw = (await query(`SELECT id, project_id, farm_id, credits, area_ha, geojson FROM public.plots`)) as unknown as SaasPlotRaw[];
  return raw.map(parsePlotAgriInputs);
}

/** Farm names for a set of ids — display-only lookup for reports (the Allocation Register itself stores only the SaaS farm id, never a name, to avoid a second place a rename could go stale). */
export async function listFarmNamesByIds(farmIds: string[]): Promise<Map<string, string>> {
  if (!farmIds.length) return new Map();
  const { query } = await import("../db");
  const rows = await query<{ id: string; farm_name: string }>(
    `SELECT id, farm_name FROM public.farms WHERE id = ANY($1::uuid[])`,
    [[...new Set(farmIds)]],
  );
  return new Map(rows.map((r) => [r.id, r.farm_name]));
}

/** Signed Agri-Inputs / Pre-Financing agreements for a set of reservations, same type filter as agriDealLifecycle.ts's AGRI_DEAL_TYPES. */
export async function listAgriContractsForReservations(reservationIds: string[]): Promise<SaasContractRow[]> {
  if (!reservationIds.length) return [];
  const { query } = await import("../db");
  return (await query(
    `SELECT reservation_id, status, signed_at FROM public.contracts
      WHERE reservation_id = ANY($1::uuid[]) AND type IN ('funding_agri_inputs', 'pre_financing')`,
    [reservationIds],
  )) as unknown as SaasContractRow[];
}

export interface SaasContractDetail {
  id: string;
  type: string;
  status: "draft" | "sent" | "signed" | "countersigned";
  signedAt: string | null;
  reservationId: string | null;
  financingId: string | null;
  transactionNo: string | null;
  totalPrice: string | null;
  creditPrice: string | null;
  allocatedCredits: string | null;
  signerName: string | null;
  counterSignedBy: string | null;
  registryNo: string | null;
}

/**
 * Contract details for the "click a transaction # to see the signed
 * agreement" popup (Nitzan, 2026-08-31). Callers must match by
 * reservationId (agri_inputs) or financingId (project_funding) — NOT by
 * transactionNo. Confirmed live 2026-08-31: two agri_inputs contracts
 * signed in the same flow carried the SAME data.transaction_no (copied
 * from one reservation onto the other's contract row) despite belonging
 * to two different real reservations — a real labeling quirk in the
 * SaaS's own contract data, not something safe to key a lookup on.
 */
export async function listContractDetailsByProfileIds(profileIds: string[]): Promise<SaasContractDetail[]> {
  const ids = [...new Set(profileIds)];
  if (!ids.length) return [];
  const { query } = await import("../db");
  const rows = await query<{
    id: string;
    type: string;
    status: "draft" | "sent" | "signed" | "countersigned";
    signed_at: string | null;
    reservation_id: string | null;
    data: {
      transaction_no?: string;
      financing_id?: string;
      total_price?: string;
      credit_price?: string;
      allocated_credits?: string;
      signerName?: string;
      counterSignedBy?: string;
      registry_no?: string;
    } | null;
  }>(`SELECT id, type, status, signed_at, reservation_id, data FROM public.contracts WHERE profile_id = ANY($1::uuid[])`, [ids]);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    signedAt: r.signed_at,
    reservationId: r.reservation_id,
    financingId: r.data?.financing_id ?? null,
    transactionNo: r.data?.transaction_no ?? null,
    totalPrice: r.data?.total_price ?? null,
    creditPrice: r.data?.credit_price ?? null,
    allocatedCredits: r.data?.allocated_credits ?? null,
    signerName: r.data?.signerName ?? null,
    counterSignedBy: r.data?.counterSignedBy ?? null,
    registryNo: r.data?.registry_no ?? null,
  }));
}

export async function listCreditBuyersByProfileIds(profileIds: string[]): Promise<SaasCreditBuyer[]> {
  if (!profileIds.length) return [];
  const { query } = await import("../db");
  return (await query(
    `SELECT profile_id, company_name FROM public.credit_buyers WHERE profile_id = ANY($1::uuid[])`,
    [profileIds],
  )) as unknown as SaasCreditBuyer[];
}

export async function listSaasProjects(): Promise<SaasProject[]> {
  const { query } = await import("../db");
  return (await query(`SELECT id, name, credit_price_usd FROM public.projects`)) as unknown as SaasProject[];
}

/**
 * Reads a JSON ledger file straight out of Supabase Storage over REST (no
 * @supabase/supabase-js dependency — this one genuinely has no SQL
 * equivalent, unlike the table reads above) — the same "config" bucket
 * carbonature-saas's own reservationPayments.ts /
 * projectFinancing.ts write to. Read-only, like the rest of this file.
 */
async function readStorageJson<T>(bucket: string, file: string): Promise<T[]> {
  assertConfigured();
  const res = await fetch(`${SAAS_SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(file)}`, {
    headers: {
      apikey: SAAS_SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SAAS_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (res.status === 404) return []; // ledger not created yet, same fallback as the SaaS's own readAll()
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SaaS Storage object ${bucket}/${file} returned ${res.status}: ${body}`);
  }
  const parsed: unknown = await res.json();
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export interface SaasReservationPayment {
  reservationId: string;
  transactionNo?: string;
  paidAt: string;
}

/** reservation-payments.json, matches carbonature-saas/src/lib/reservationPayments.ts's own shape exactly. */
export async function readReservationPaymentsLedger(): Promise<SaasReservationPayment[]> {
  return readStorageJson<SaasReservationPayment>("config", "reservation-payments.json");
}

export interface SaasProjectFinancing {
  id: string;
  buyerId: string;
  projectKey: string;
  projectName: string;
  amountUsd: number;
  creditPriceUsd: number;
  credits: number;
  transactionNo: string;
  createdAt: string;
  status: "awaiting_signature" | "pending_payment" | "paid";
  signedAt?: string;
  paidAt?: string;
}

/** project-financings.json, matches carbonature-saas/src/lib/projectFinancing.ts's own shape exactly. */
export async function readProjectFinancingsLedger(): Promise<SaasProjectFinancing[]> {
  return readStorageJson<SaasProjectFinancing>("config", "project-financings.json");
}

/**
 * Read access for Ron's retention sequences (ronRetentionSequence.ts).
 */

export interface SaasActivityStatus {
  farm_id: string | null;
  reservation_id: string | null;
  current_status: string;
  updated_at: string;
}

export async function listActivityStatusByFarmIds(farmIds: string[]): Promise<SaasActivityStatus[]> {
  if (!farmIds.length) return [];
  const { query } = await import("../db");
  return (await query(
    `SELECT farm_id, reservation_id, current_status, updated_at FROM public.activity_status
      WHERE farm_id = ANY($1::uuid[]) ORDER BY updated_at DESC`,
    [farmIds],
  )) as unknown as SaasActivityStatus[];
}

export async function listActivityStatusByReservationIds(reservationIds: string[]): Promise<SaasActivityStatus[]> {
  if (!reservationIds.length) return [];
  const { query } = await import("../db");
  return (await query(
    `SELECT farm_id, reservation_id, current_status, updated_at FROM public.activity_status
      WHERE reservation_id = ANY($1::uuid[]) ORDER BY updated_at DESC`,
    [reservationIds],
  )) as unknown as SaasActivityStatus[];
}

/** email per SaaS profile id — used to match a buyer's mrv-side records back to their crm.leads row (leads carry email, not the SaaS profile id). */
export async function listSaasProfileEmails(profileIds: string[]): Promise<Map<string, string>> {
  if (!profileIds.length) return new Map();
  const { query } = await import("../db");
  const rows = await query<{ id: string; email: string }>(
    `SELECT id, email FROM public.profiles WHERE id = ANY($1::uuid[])`,
    [[...new Set(profileIds)]],
  );
  return new Map(rows.map((r) => [r.id, r.email]));
}

export interface SaasPlotCropCycle {
  id: string;
  farm_id: string | null;
  project_id: string;
  crop: string | null;
  planting_date: string | null;
  agri_inputs: { agriInput: string; activity?: string; cost?: number }[] | null;
  plants_density: number | null;
}

/**
 * Every plot's crop-cycle info-window data (crop/planting_date/agri_inputs/
 * plants_density) — confirmed live there are no separate DB columns for
 * these; they live inside plots.geojson.properties (carbonature-saas's
 * src/app/api/plots/route.ts is the source of truth for this shape).
 */
export async function listAllSaasPlotCropCycles(): Promise<SaasPlotCropCycle[]> {
  const { query } = await import("../db");
  const rows = await query<{ id: string; farm_id: string | null; project_id: string; geojson: { properties?: Record<string, unknown> } }>(
    `SELECT id, farm_id, project_id, geojson FROM public.plots`,
  );
  return rows.map((r) => {
    const props = r.geojson?.properties ?? {};
    return {
      id: r.id,
      farm_id: r.farm_id,
      project_id: r.project_id,
      crop: (props.crop as string) ?? null,
      planting_date: (props.planting_date as string) ?? null,
      agri_inputs: (props.agri_inputs as SaasPlotCropCycle["agri_inputs"]) ?? null,
      plants_density: props.plants_density != null ? Number(props.plants_density) : null,
    };
  });
}

/** owning profile_id per farm id — the join step to reach a farm's email via listSaasProfileEmails, since crm.leads is matched by email, not by farm id. */
export async function listFarmProfileIds(farmIds: string[]): Promise<Map<string, string>> {
  if (!farmIds.length) return new Map();
  const { query } = await import("../db");
  const rows = await query<{ id: string; profile_id: string }>(
    `SELECT id, profile_id FROM public.farms WHERE id = ANY($1::uuid[])`,
    [[...new Set(farmIds)]],
  );
  return new Map(rows.map((r) => [r.id, r.profile_id]));
}

/** A farm's registered crops (multi-select at onboarding) — the input to resolveProjectKeyForCrops(), never the plot's own single `crop` field. */
export async function listFarmCropsByIds(farmIds: string[]): Promise<Map<string, string[]>> {
  if (!farmIds.length) return new Map();
  const { query } = await import("../db");
  const rows = await query<{ id: string; crops: string[] | null }>(
    `SELECT id, crops FROM public.farms WHERE id = ANY($1::uuid[])`,
    [[...new Set(farmIds)]],
  );
  return new Map(rows.map((r) => [r.id, r.crops ?? []]));
}

/**
 * Reads a single JSON object out of Supabase Storage (settings.json is one
 * PlatformSettings object, not an array — readStorageJson above assumes an
 * array and would silently return [] for this file).
 */
async function readStorageObject<T>(bucket: string, file: string): Promise<T | null> {
  assertConfigured();
  const res = await fetch(`${SAAS_SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(file)}`, {
    headers: {
      apikey: SAAS_SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SAAS_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SaaS Storage object ${bucket}/${file} returned ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * A financing project's credit-yield config — mirrors carbonature-saas's own
 * FinancingProject (src/lib/settings.ts) field-for-field. This is now the
 * single source of truth for credit-yield rates and orchard-age brackets;
 * MRV never keeps its own copy of these numbers (see plotTypeResolver.ts).
 */
export interface SaasFinancingProject {
  key: string;
  kind: "open_field" | "plantation";
  startDate: string;
  creditsPerHa: number;
  youngCreditsPerHa: number;
  matureCreditsPerHa: number;
  youngMaxAgeYears: number;
}

/** settings.json's `projects` array — the SaaS admin panel Nitzan edits credit-yield/orchard-age values in. */
export async function getSaasFinancingProjects(): Promise<SaasFinancingProject[]> {
  const settings = await readStorageObject<{ projects?: SaasFinancingProject[] }>("config", "settings.json");
  return settings?.projects ?? [];
}
