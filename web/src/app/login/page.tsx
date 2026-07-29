import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IconMark } from "@/components/brand/Logo";
import { Card } from "@/components/ui/Card";

/**
 * Screen 1 — Login & Workspace (spec §6.1).
 * Internal users sign in with Google Workspace SSO; external samplers never
 * log in here (they use a one-tap MCP token, Screen 6). Until the Google
 * OAuth client is provisioned, the button runs a dev sign-in that stamps a
 * session cookie for the Super Admin and routes to the Project Map.
 */

async function devSignIn() {
  "use server";
  const jar = await cookies();
  jar.set("mrv_session", "dev:super-admin", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect("/map");
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <Card imprint className="w-full max-w-sm p-8">
        <div className="flex flex-col items-center text-center">
          <IconMark size={52} />
          <h1 className="mt-4 text-lg font-bold text-pine-700">CarboNature MRV</h1>
          <p className="font-mono text-xs tracking-wide text-muted">Verified Credits Factory</p>

          <form action={devSignIn} className="mt-6 w-full space-y-3">
            <input
              type="email"
              name="email"
              defaultValue="nitzan@carbonature.io"
              autoComplete="username"
              className="w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-sage-400"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-pine-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
            >
              Sign in with Google Workspace
            </button>
          </form>

          <p className="mt-4 font-mono text-[10.5px] text-faint">
            SSO · password fallback · MFA
          </p>
          <p className="mt-1 rounded-full bg-gold-200 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-earth-600">
            dev sign-in — Google SSO wired at deploy
          </p>
        </div>
      </Card>
    </div>
  );
}
