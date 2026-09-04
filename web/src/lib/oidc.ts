import "server-only";
import { SignJWT, jwtVerify } from "jose";

/**
 * MRV as the identity provider for staff (Addendum 2, Part B) — a small,
 * real OAuth2/OIDC-shaped surface, not a config change. MRV keeps its
 * existing Google OAuth + @carbonature.io domain gate as the actual
 * authentication event (auth.ts, unchanged); this module only signs and
 * verifies the short-lived grants that let CRM (and, via the SaaS's own
 * bridge route, the SaaS's admin section) trust a session MRV already
 * verified, instead of running a second, independent Google sign-in.
 *
 * HS256 with one shared secret (MRV_OIDC_SIGNING_SECRET, set identically in
 * MRV, the CRM, and the SaaS) rather than a full public/private-key OIDC
 * provider — appropriate here because every party trusting these tokens is
 * a first-party app this same person controls, not a third-party client.
 */

const ISSUER = "mrv-oidc";

/** The only two parties allowed to exchange a code / accept a bridge token, and where each is allowed to land. */
export const OIDC_CLIENTS: Record<string, { redirectUri: string }> = {
  crm: {
    redirectUri:
      process.env.CRM_OIDC_CALLBACK_URL ?? "https://carbonature-crm-nitzan-s-projects4.vercel.app/api/auth/callback/mrv",
  },
  saas: { redirectUri: process.env.SAAS_STAFF_BRIDGE_URL ?? "https://app.carbonature.io/api/staff-bridge" },
};

function secretKey(): Uint8Array {
  const secret = process.env.MRV_OIDC_SIGNING_SECRET;
  if (!secret) throw new Error("MRV_OIDC_SIGNING_SECRET is not set — the staff SSO bridge cannot sign or verify anything without it.");
  return new TextEncoder().encode(secret);
}

export interface StaffClaims {
  email: string;
  name: string;
  /** Real role from mrv.project_memberships at the moment this grant was issued — null if the person has none yet. */
  role: string | null;
}

/** A one-time authorization code, valid for 60 seconds — long enough for the immediate redirect-and-exchange, no longer. */
export async function signAuthCode(clientId: string, claims: StaffClaims): Promise<string> {
  return new SignJWT({ ...claims, client_id: clientId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(clientId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(secretKey());
}

export async function verifyAuthCode(token: string, clientId: string): Promise<(StaffClaims & { jti: string }) | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: clientId });
    if (!payload.jti) return null;
    return { email: String(payload.email), name: String(payload.name), role: (payload.role as string | null) ?? null, jti: payload.jti };
  } catch {
    return null;
  }
}

/** The real session grant — what CRM's own session (or the SaaS's bridge cookie) is actually built from. Same lifetime as MRV's own session (12h). */
export async function signStaffGrant(clientId: string, claims: StaffClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey());
}

export async function verifyStaffGrant(token: string, clientId: string): Promise<StaffClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: clientId });
    return { email: String(payload.email), name: String(payload.name), role: (payload.role as string | null) ?? null };
  } catch {
    return null;
  }
}
