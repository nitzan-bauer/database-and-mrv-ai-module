import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
 */

const ALLOWED_DOMAIN = process.env.AUTH_ALLOWED_DOMAIN?.trim() || "carbonature.io";

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
          // Ask Google to show only the workspace, and to re-check which
          // account is in use rather than silently reusing the last one.
          authorization: {
            params: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
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
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase() ?? "";
      const verified = profile?.email_verified !== false;
      return verified && email.endsWith(`@${ALLOWED_DOMAIN}`);
    },

    jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      if (profile?.name) token.name = profile.name;
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
      }
      return session;
    },
  },

  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // a working day
  trustHost: true,
});

export { ALLOWED_DOMAIN };
