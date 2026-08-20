import "server-only";

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/**
 * Persist the Google refresh token that already arrives on every sign-in
 * (src/auth.ts's Google provider requests access_type=offline +
 * prompt=select_account consent) but today only ever lives inside the
 * signed-in browser's JWT cookie. Called from auth.ts's own `jwt`
 * callback, right where it already sets `token.googleRefreshToken` —
 * purely additive, the live-session behavior is unchanged.
 */
export async function persistGoogleRefreshToken(query: Query, email: string, refreshToken: string): Promise<void> {
  if (!email || !refreshToken) return;
  await query(
    `UPDATE mrv.users
        SET google_refresh_token = $2, google_refresh_token_updated_at = clock_timestamp()
      WHERE email = $1`,
    [email.toLowerCase(), refreshToken],
  );
}

/**
 * Mint a fresh Google access token for a person's stored refresh token —
 * no browser session involved. This is what lets an unattended run (a
 * cron job) call a Drive/Gmail tool "as" whoever's stored refresh token
 * it uses, the same real request shape as src/auth.ts's own
 * refreshGoogleAccessToken (kept as one implementation rather than two
 * copies of the Google token-exchange call).
 *
 * Returns null rather than throwing on any failure (no stored token,
 * Google rejects it, network error) — a cron dispatch loop should
 * record "this task's Google step failed" and move on to the next task,
 * never crash the whole run over one person's stale credential.
 */
export async function getServiceGoogleAccessToken(query: Query, email: string): Promise<string | null> {
  const rows = await query<{ google_refresh_token: string | null }>(
    `SELECT google_refresh_token FROM mrv.users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const refreshToken = rows[0]?.google_refresh_token;
  if (!refreshToken) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID ?? "",
        client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!res.ok || !data.access_token) return null;

    // Google does not always return a new refresh_token — only overwrite
    // the stored one when it actually hands back a fresh one.
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      await persistGoogleRefreshToken(query, email, data.refresh_token);
    }
    return data.access_token;
  } catch {
    return null;
  }
}
