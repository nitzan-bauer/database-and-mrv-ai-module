import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IconMark } from "@/components/brand/Logo";
import { Card } from "@/components/ui/Card";
import { ALLOWED_DOMAIN, auth, signIn, ssoConfigured } from "@/auth";

/**
 * Screen 1 — Login & Workspace (spec §6.1).
 *
 * Google Workspace SSO once the OAuth client exists. Until it does, a
 * clearly-labelled development sign-in keeps the module usable — labelled
 * because an unmarked bypass is the kind of thing that survives to
 * production.
 *
 * External samplers never arrive here: they hold a work-order-scoped MCP
 * token and their route sits outside the authenticated area.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  // Only ask Auth.js anything when it is actually configured. Calling auth()
  // without a secret throws MissingSecret, which the catch would swallow into
  // a logged error on every single page load.
  if (ssoConfigured) {
    const session = await auth().catch(() => null);
    if (session?.user) redirect(callbackUrl || "/projects");
  }

  async function googleSignIn() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl || "/projects" });
  }

  async function devSignIn() {
    "use server";
    const jar = await cookies();
    jar.set("mrv_dev_session", "dev:super-admin", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    redirect(callbackUrl || "/projects");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <Card imprint className="w-full max-w-sm p-8">
        <div className="flex flex-col items-center text-center">
          <IconMark size={52} />
          <h1 className="mt-4 text-lg font-bold text-pine-700">CarboNature MRV</h1>
          <p className="font-mono text-xs tracking-wide text-muted">Verified Credits Factory</p>

          {error && (
            <p className="mt-4 w-full rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
              {error === "AccessDenied"
                ? `That account is not on @${ALLOWED_DOMAIN}. Sign in with your CarboNature address.`
                : "Sign-in did not complete. Try again."}
            </p>
          )}

          {ssoConfigured ? (
            <form action={googleSignIn} className="mt-6 w-full">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-pine-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
              >
                <GoogleMark />
                Sign in with Google Workspace
              </button>
            </form>
          ) : (
            <form action={devSignIn} className="mt-6 w-full space-y-3">
              <button
                type="submit"
                className="w-full rounded-lg bg-pine-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
              >
                Continue
              </button>
            </form>
          )}

          <p className="mt-4 font-mono text-[10.5px] text-faint">
            {ssoConfigured ? `SSO · @${ALLOWED_DOMAIN} only · MFA per Workspace policy` : "SSO · password fallback · MFA"}
          </p>

          {!ssoConfigured && (
            <p className="mt-1 rounded-full bg-gold-200 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-earth-600">
              dev sign-in — Google SSO not configured
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Google's mark, so the button reads as the real thing. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.9 36.2 44 30.7 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
