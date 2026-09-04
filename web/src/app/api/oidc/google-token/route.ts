import { NextResponse } from "next/server";
import { OIDC_CLIENTS, verifyStaffGrant } from "@/lib/oidc";

/**
 * Lets a bridged app (the CRM) get a LIVE Google access token for whichever
 * staff member is signed in via the MRV bridge, without CRM ever holding
 * that person's refresh token itself. The staff grant from /api/oidc/token
 * lasts 12h to match the session, but a Google access token itself only
 * lasts ~1h — so instead of smuggling a soon-to-expire token through the
 * grant, the CRM calls back here whenever it actually needs one, the same
 * way this module's own scheduled tasks already do via
 * getServiceGoogleAccessToken (lib/google/serviceAuth.ts). This preserves
 * exactly the behavior the CRM's own auth.ts used to get for free from its
 * separate direct Google OAuth — the Calendar/Gmail scopes MRV's own
 * sign-in already holds for this person, not a new grant of access they
 * don't otherwise have.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return NextResponse.json({ error: "invalid_request" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId = body.client_id as string | undefined;
  if (!clientId || !OIDC_CLIENTS[clientId]) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const claims = await verifyStaffGrant(token, clientId);
  if (!claims) return NextResponse.json({ error: "invalid_token" }, { status: 401 });

  try {
    const { query } = await import("@/lib/db");
    const { getServiceGoogleAccessToken } = await import("@/lib/google/serviceAuth");
    const accessToken = await getServiceGoogleAccessToken(query, claims.email);
    if (!accessToken) {
      return NextResponse.json({ error: "no_google_token", error_description: "No persisted Google refresh token for this person yet — they need to sign in to MRV itself once first." }, { status: 404 });
    }
    return NextResponse.json({ access_token: accessToken, expires_in: 3600 });
  } catch (e) {
    return NextResponse.json({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
