import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { decode as defaultDecode } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";

/**
 * Google Workspace SSO (spec §6.1).
 *
 * Internal staff sign in with their carbonature.io Google account. External
 * sampling contractors never reach this — they hold a work-order-scoped MCP
 * token and their route sits outside the authenticated area entirely.
 *
 * Two things are deliberate:
 *
 *   - Sign-in is refused for any address outside ALLOWED_DOMAIN. Google will
 *     happily authenticate a personal gmail account, and "signed in with
 *     Google" is not the same claim as "works here".
 *   - Sessions are JWT, not database-backed. The identities that matter are
 *     already in mrv.users; adding an adapter would give us a second, drifting
 *     copy of them for no benefit at this size.
 *
 * The Drive scope (0032, Jennifer's document_centralisation) rides on this
 * same sign-in rather than a separate service identity: every Drive action
 * runs as whichever person is signed in, with exactly the access they
 * already have by hand in Drive — nothing is granted that a human here
 * doesn't already hold.
 */

const ALLOWED_DOMAIN = process.env.AUTH_ALLOWED_DOMAIN?.trim() || "carbonature.io";

declare module "next-auth/jwt" {
  interface JWT {
    googleAccessToken?: string;
    googleRefreshToken?: string;
    googleAccessTokenExpires?: number;
  }
}

declare module "next-auth" {
  interface Session {
    /** Present only when the signed-in account granted the Drive scope. Never sent to the client. */
    googleAccessToken?: string;
  }
}

/**
 * Google's own documented refresh-token-rotation shape
 * (developers.google.com/identity/protocols/oauth2/web-server#offline).
 * A failure here is not fatal to the session — it just means whatever Drive
 * action prompted a refresh will fail with an honest "reconnect Drive"
 * message rather than a broken sign-in.
 */
async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID ?? "",
        client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.googleRefreshToken ?? "",
      }),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
    if (!res.ok || !data.access_token) {
      return { ...token, googleAccessToken: undefined };
    }
    return {
      ...token,
      googleAccessToken: data.access_token,
      googleAccessTokenExpires: Date.now() + (data.expires_in ?? 3600) * 1000,
      // Google does not always return a new refresh_token — keep the old one when it doesn't.
      googleRefreshToken: data.refresh_token ?? token.googleRefreshToken,
    };
  } catch {
    return { ...token, googleAccessToken: undefined };
  }
}

/**
 * SSO counts as configured only when all three are present. AUTH_SECRET is
 * included deliberately: without it Auth.js throws MissingSecret on the first
 * call, so treating two-out-of-three as "configured" would half-enable SSO
 * and lock everyone out with a stack trace instead of a sign-in button.
 */
export const ssoConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET,
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: ssoConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          authorization: {
            params: {
              hd: ALLOWED_DOMAIN,
              // access_type=offline + prompt including "consent" are what
              // make Google actually return a refresh_token — without both,
              // a returning user's silent re-consent gets none, and Drive
              // access quietly dies the moment the access token expires.
              // "select_account" is kept alongside it (space-separated,
              // both apply) so re-checking which account is in use is not lost.
              access_type: "offline",
              prompt: "select_account consent",
              // gmail.send added for the PDD Generator pipeline (sync_pdd_google_doc's
              // sibling — the pipeline emails the exported PDF to whoever ran it).
              // gmail.settings.basic added for per-agent send-as signatures
              // (agentEmailAliases.ts) — managing a sendAs alias's signature
              // needs this scope; gmail.send alone cannot touch it.
              // gmail.settings.sharing is a SEPARATE, more specific scope
              // Google requires on top of settings.basic specifically for
              // modifying a non-primary sendAs address (confirmed live:
              // settings.basic alone got "Missing required scope ...sharing
              // for modifying non-primary SendAs" from the API itself).
              // Anyone signed in before this needs to sign out and back in, same as
              // every earlier scope addition here — Google does not retroactively
              // grant a scope to an existing session's token.
              scope:
                "openid email profile https://www.googleapis.com/auth/drive " +
                "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send " +
                "https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/gmail.settings.sharing " +
                "https://www.googleapis.com/auth/calendar",
            },
          },
        }),
      ]
    : [],

  pages: { signIn: "/login", error: "/login" },

  callbacks: {
    /**
     * The domain check. `hd` above is a UI hint to Google, not a guarantee —
     * it can be bypassed — so the address is verified here, where it counts.
     */
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase() ?? "";
      const verified = profile?.email_verified !== false;
      if (!verified || !email.endsWith(`@${ALLOWED_DOMAIN}`)) return false;

      // Give the person a row in mrv.users while we know who they are.
      // mrv.work_orders.issued_by is a foreign key into it, under a CHECK
      // that a work order which has left 'draft' records who issued it — so
      // without this the chain cannot be written at all.
      //
      // A failure here does not block the sign-in. Google has already
      // established the identity, and refusing entry because the database
      // was briefly unreachable would turn a transient fault into a lockout;
      // the tools that need a user_id resolve it themselves and say so if it
      // is missing.
      try {
        const { ensureUser } = await import("./lib/tools/ensureUser");
        const r = await ensureUser(
          { actor: email, actorKind: "human" },
          { email, fullName: profile?.name ?? null },
        );
        if (!r.ok) console.warn(`[auth] could not record the user: ${r.error}`);
      } catch (e) {
        console.warn(`[auth] could not record the user: ${e instanceof Error ? e.message : e}`);
      }

      return true;
    },

    async jwt({ token, profile, account }) {
      if (profile?.email) token.email = profile.email;
      if (profile?.name) token.name = profile.name;

      // `account` is only present on the initial sign-in call — this is
      // where Google's tokens first arrive.
      if (account?.access_token) {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token;
        token.googleAccessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined;

        // Persist it (0072) so an unattended cron run can mint its own
        // access token later — same non-fatal-on-failure stance as
        // ensureUser above: a DB hiccup here must not block sign-in.
        if (token.email && account.refresh_token) {
          try {
            const { query } = await import("./lib/db");
            const { persistGoogleRefreshToken } = await import("./lib/google/serviceAuth");
            await persistGoogleRefreshToken(query, token.email as string, account.refresh_token);
          } catch (e) {
            console.warn(`[auth] could not persist the Google refresh token: ${e instanceof Error ? e.message : e}`);
          }
        }

        return token;
      }

      // Still valid — nothing to do. A minute of slack avoids refreshing
      // on every single request right at the boundary.
      if (token.googleAccessTokenExpires && Date.now() < token.googleAccessTokenExpires - 60_000) {
        return token;
      }
      if (!token.googleRefreshToken) return token;
      return refreshGoogleAccessToken(token);
    },

    session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
      }
      // Server-only: nothing in this codebase spreads the whole session
      // object into a client component, so this never reaches the browser.
      session.googleAccessToken = token.googleAccessToken;
      return session;
    },
  },

  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // a working day
  trustHost: true,

  jwt: {
    /**
     * A session cookie signed with a different AUTH_SECRET than the one
     * currently loaded — left over from an earlier dev run, a restarted
     * server, or a secret rotation — makes the default decode throw
     * JWTSessionError. Uncaught, that crashes every page that calls
     * auth(), including the login page itself, into a confusing 404
     * ("that plot, work order or page does not exist") instead of just
     * prompting a fresh sign-in. A cookie that cannot be decoded is
     * exactly a session that doesn't exist — treat it as null, not a
     * server error.
     */
    async decode(params) {
      try {
        return await defaultDecode(params);
      } catch {
        return null;
      }
    },
  },
});

export { ALLOWED_DOMAIN };
