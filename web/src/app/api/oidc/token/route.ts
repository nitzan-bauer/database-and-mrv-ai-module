import { NextResponse } from "next/server";
import { OIDC_CLIENTS, signStaffGrant, verifyAuthCode } from "@/lib/oidc";

/**
 * MRV as the identity provider for staff (Addendum 2, Part B) —
 * OAuth2-style /token. Exchanges the one-time code from /authorize for the
 * real, longer-lived staff grant (12h, matching MRV's own session length).
 * Server-to-server only — the CRM's own NextAuth backend calls this, never
 * a browser directly.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let code: string | undefined;
  let clientId: string | undefined;
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    code = body.code;
    clientId = body.client_id;
  } else {
    const form = await req.formData().catch(() => null);
    code = form?.get("code")?.toString();
    clientId = form?.get("client_id")?.toString();
  }

  if (!code || !clientId || !OIDC_CLIENTS[clientId]) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const claims = await verifyAuthCode(code, clientId);
  if (!claims) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  // Replay guard: this exact code (jti) can only ever be exchanged once,
  // even though it's a self-verifying signed JWT that would otherwise
  // still "work" again within its own 60s expiry window.
  try {
    const { query } = await import("@/lib/db");
    const inserted = await query(`INSERT INTO mrv.oidc_used_codes (jti) VALUES ($1) ON CONFLICT DO NOTHING RETURNING jti`, [claims.jti]);
    if (!inserted.length) {
      return NextResponse.json({ error: "invalid_grant", error_description: "code already used" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const grant = await signStaffGrant(clientId, { email: claims.email, name: claims.name, role: claims.role });
  return NextResponse.json({
    access_token: grant,
    id_token: grant,
    token_type: "Bearer",
    expires_in: 12 * 60 * 60,
  });
}
