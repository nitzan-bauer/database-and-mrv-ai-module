import "server-only";
import { SAAS_SUPABASE_SERVICE_ROLE_KEY, SAAS_SUPABASE_URL } from "../env";

/**
 * Raw PostgREST reads against the customer-facing SaaS Supabase database —
 * no @supabase/supabase-js dependency, matching how driveClient.ts and
 * gmailClient.ts already talk to Google's REST APIs directly. Read-only:
 * nothing here can write back to the SaaS database, on purpose — a real
 * PDD import has no business mutating the marketplace/onboarding data.
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

async function restGet<T>(path: string): Promise<T> {
  assertConfigured();
  const res = await fetch(`${SAAS_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SAAS_SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SAAS_SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SaaS Supabase REST ${path} returned ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

/** One farm by its SaaS id, or null if it doesn't exist there. */
export async function fetchSaasFarm(saasFarmId: string): Promise<SaasFarm | null> {
  const rows = await restGet<SaasFarm[]>(
    `farms?id=eq.${encodeURIComponent(saasFarmId)}&select=id,farm_name,company_name,addr_country,addr_city,cultivation_area,cultivation_unit,crops,contact_first,contact_surname`,
  );
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
  return restGet<SaasFarm[]>(
    `farms?created_at=gt.${encodeURIComponent(sinceIso)}&select=id,farm_name,company_name,addr_country,addr_city,cultivation_area,cultivation_unit,crops,contact_first,contact_surname&order=created_at.asc`,
  );
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
  /** The AGRI INPUTS product(s)/practice(s) chosen for this plot — from plots.geojson.properties.agri_inputs (falls back to the single agri_input string when that's all a plot has). Empty for a plot with no Agri-Inputs activity at all. */
  agriInputs: string[];
}

interface SaasPlotRaw {
  id: string;
  project_id: string;
  farm_id: string | null;
  credits: number;
  area_ha: number;
  geojson: { properties?: { agri_input?: string | null; agri_inputs?: { agriInput?: string | null }[] | null } } | null;
}

function parsePlotAgriInputs(raw: SaasPlotRaw): SaasPlot {
  const props = raw.geojson?.properties;
  const fromList = (props?.agri_inputs ?? [])
    .map((a) => a.agriInput)
    .filter((a): a is string => Boolean(a));
  const agriInputs = fromList.length ? [...new Set(fromList)] : props?.agri_input ? [props.agri_input] : [];
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
  return restGet<SaasReservation[]>(
    "reservations?select=id,buyer_id,project_id,transaction_no,total_cost_usd,allocated_credits,application_area_ha,created_at&order=created_at.asc",
  );
}

export async function listReservationPlots(reservationIds: string[]): Promise<SaasReservationPlot[]> {
  if (!reservationIds.length) return [];
  return restGet<SaasReservationPlot[]>(
    `reservation_plots?reservation_id=in.(${reservationIds.map(encodeURIComponent).join(",")})&select=reservation_id,plot_id`,
  );
}

export async function listPlotsByIds(plotIds: string[]): Promise<SaasPlot[]> {
  if (!plotIds.length) return [];
  const raw = await restGet<SaasPlotRaw[]>(
    `plots?id=in.(${plotIds.map(encodeURIComponent).join(",")})&select=id,project_id,farm_id,credits,area_ha,geojson`,
  );
  return raw.map(parsePlotAgriInputs);
}

/** Every plot in the SaaS marketplace, not just ones already tied to a reservation — the potential estimate covers unsold plots too. */
export async function listAllSaasPlots(): Promise<SaasPlot[]> {
  const raw = await restGet<SaasPlotRaw[]>("plots?select=id,project_id,farm_id,credits,area_ha,geojson");
  return raw.map(parsePlotAgriInputs);
}

/** Farm names for a set of ids — display-only lookup for reports (the Allocation Register itself stores only the SaaS farm id, never a name, to avoid a second place a rename could go stale). */
export async function listFarmNamesByIds(farmIds: string[]): Promise<Map<string, string>> {
  if (!farmIds.length) return new Map();
  const rows = await restGet<{ id: string; farm_name: string }[]>(
    `farms?id=in.(${[...new Set(farmIds)].map(encodeURIComponent).join(",")})&select=id,farm_name`,
  );
  return new Map(rows.map((r) => [r.id, r.farm_name]));
}

/** Signed Agri-Inputs / Pre-Financing agreements for a set of reservations, same type filter as agriDealLifecycle.ts's AGRI_DEAL_TYPES. */
export async function listAgriContractsForReservations(reservationIds: string[]): Promise<SaasContractRow[]> {
  if (!reservationIds.length) return [];
  return restGet<SaasContractRow[]>(
    `contracts?reservation_id=in.(${reservationIds.map(encodeURIComponent).join(",")})&type=in.(funding_agri_inputs,pre_financing)&select=reservation_id,status,signed_at`,
  );
}

export async function listCreditBuyersByProfileIds(profileIds: string[]): Promise<SaasCreditBuyer[]> {
  if (!profileIds.length) return [];
  return restGet<SaasCreditBuyer[]>(
    `credit_buyers?profile_id=in.(${profileIds.map(encodeURIComponent).join(",")})&select=profile_id,company_name`,
  );
}

export async function listSaasProjects(): Promise<SaasProject[]> {
  return restGet<SaasProject[]>("projects?select=id,name,credit_price_usd");
}

/**
 * Reads a JSON ledger file straight out of Supabase Storage over REST (no
 * @supabase/supabase-js dependency, matching restGet above) — the same
 * "config" bucket carbonature-saas's own reservationPayments.ts /
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
  return restGet<SaasActivityStatus[]>(
    `activity_status?farm_id=in.(${farmIds.map(encodeURIComponent).join(",")})&select=farm_id,reservation_id,current_status,updated_at&order=updated_at.desc`,
  );
}

export async function listActivityStatusByReservationIds(reservationIds: string[]): Promise<SaasActivityStatus[]> {
  if (!reservationIds.length) return [];
  return restGet<SaasActivityStatus[]>(
    `activity_status?reservation_id=in.(${reservationIds.map(encodeURIComponent).join(",")})&select=farm_id,reservation_id,current_status,updated_at&order=updated_at.desc`,
  );
}

/** email per SaaS profile id — used to match a buyer's mrv-side records back to their crm.leads row (leads carry email, not the SaaS profile id). */
export async function listSaasProfileEmails(profileIds: string[]): Promise<Map<string, string>> {
  if (!profileIds.length) return new Map();
  const rows = await restGet<{ id: string; email: string }[]>(
    `profiles?id=in.(${[...new Set(profileIds)].map(encodeURIComponent).join(",")})&select=id,email`,
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
  const rows = await restGet<{ id: string; farm_id: string | null; project_id: string; geojson: { properties?: Record<string, unknown> } }[]>(
    "plots?select=id,farm_id,project_id,geojson",
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
  const rows = await restGet<{ id: string; profile_id: string }[]>(
    `farms?id=in.(${[...new Set(farmIds)].map(encodeURIComponent).join(",")})&select=id,profile_id`,
  );
  return new Map(rows.map((r) => [r.id, r.profile_id]));
}
