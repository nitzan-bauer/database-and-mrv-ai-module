import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { OIDC_CLIENTS, signAuthCode } from "@/lib/oidc";

/**
 * MRV as the identity provider for staff (Addendum 2, Part B) —
 * OAuth2-style /authorize. The actual authentication event is still MRV's
 * own Google OAuth + @carbonature.io domain gate (auth.ts) — this endpoint
 * never asks for a password or runs its own sign-in; it only checks
 * whether the caller already has a real MRV session and, if so, mints a
 * short-lived code the requesting client (CRM, or the SaaS's staff bridge)
 * can exchange for a grant.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const client = OIDC_CLIENTS[clientId];
  if (!client || client.redirectUri !== redirectUri) {
    return NextResponse.json({ error: "Unknown client_id or redirect_uri does not match the registered one." }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  if (!session?.user?.email) {
    // Not signed in to MRV yet — send them through the real sign-in first,
    // then straight back to this exact URL to finish the handoff.
    const callback = url.toString();
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(callback)}`, url.origin));
  }

  const email = session.user.email.toLowerCase();

  let role: string | null = null;
  try {
    const { query } = await import("@/lib/db");
    const rows = await query<{ role: string }>(
      `SELECT m.role::text AS role FROM mrv.project_memberships m
         JOIN mrv.users u ON u.user_id = m.user_id
        WHERE u.email = $1`,
      [email],
    );
    const priority = ["super_admin", "mrv_manager", "ai_agent", "sampler"];
    const roles = new Set(rows.map((r) => r.role));
    role = priority.find((r) => roles.has(r)) ?? rows[0]?.role ?? null;
  } catch {
    role = null; // non-fatal — the grant still carries a verified identity even if role lookup fails
  }

  const code = await signAuthCode(clientId, { email, name: session.user.name ?? email, role });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return NextResponse.redirect(redirect);
}
