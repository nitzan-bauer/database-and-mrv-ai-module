import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ron's account-opening webhook (approved plan, Phase 3, 2026-08-26) —
 * closes the gap the Sale Cycle documents themselves already assume
 * exists ("Lead recorded in the CRM; pushed to the platform through the
 * lead-ingest webhook"), for the case that isn't AiSDR/HubSpot: someone
 * who opens an account on carbonature-saas directly. Called from
 * carbonature-saas's own src/app/api/register/route.ts, right after a
 * new profile + role-record (farms/credit_buyers) is created — fire-and
 * -forget from that side, so a webhook failure never blocks registration.
 *
 * Idempotent by email — a retried webhook call must not create a second
 * lead (crm.leads has no DB-level unique constraint on email today), so
 * this checks for an existing lead first rather than relying on
 * recordLead's own insert alone.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.MRV_ACCOUNT_WEBHOOK_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    role?: string;
    profileId?: string;
    email?: string;
    username?: string;
    companyName?: string;
    farmName?: string;
    phone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { role, profileId, email, username, companyName, phone } = body;
  if (role !== "farmer" && role !== "credit_buyer") {
    return NextResponse.json({ error: `Invalid role "${role}" — expected "farmer" or "credit_buyer".` }, { status: 400 });
  }
  if (!profileId || !email || !username) {
    return NextResponse.json({ error: "profileId, email, and username are all required." }, { status: 400 });
  }

  const { crmQuery } = await import("@/lib/crmDb");
  const { recordLead } = await import("@/lib/tools/recordLead");

  const existing = await crmQuery<{ lead_id: string }>(`SELECT lead_id FROM crm.leads WHERE email = $1 LIMIT 1`, [email]);
  if (existing.length) {
    return NextResponse.json({ ok: true, leadId: existing[0].lead_id, deduped: true });
  }

  const ctx = { actor: "ron", actorKind: "agent" as const };
  const leadResult = await recordLead(ctx, {
    leadType: role,
    fullName: username,
    email,
    phone,
    companyName,
    leadSource: "account_opening_webhook",
  });
  if (!leadResult.ok) {
    return NextResponse.json({ error: leadResult.error }, { status: 500 });
  }

  // Credit buyers alone start the KYC clock — a farmer account has no
  // KYC/AML stage in the Sale Cycle at all.
  if (role === "credit_buyer") {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO mrv.kyc_tracking (buyer_id, buyer_company_name, buyer_email)
       VALUES ($1, $2, $3)
       ON CONFLICT (buyer_id) DO NOTHING`,
      [profileId, companyName ?? username, email],
    );
  }

  return NextResponse.json({ ok: true, leadId: leadResult.data.leadId, deduped: false });
}
