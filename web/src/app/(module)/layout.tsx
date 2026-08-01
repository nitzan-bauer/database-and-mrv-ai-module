import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { auth, ssoConfigured } from "@/auth";

/**
 * The internal module chrome, and the gate in front of it.
 *
 * Everything under (module) is for signed-in staff. The login page and the
 * token-gated sampler view sit outside it and deliberately show no
 * navigation or user identity.
 *
 * Before the Google OAuth client exists, the dev sign-in cookie stands in.
 * Once SSO is configured that cookie is ignored entirely — otherwise the
 * development bypass would quietly outlive the thing it was standing in for.
 */
export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  let name = "Nitzan Bauer";
  let email: string | null = null;

  if (ssoConfigured) {
    const session = await auth().catch(() => null);
    if (!session?.user) redirect("/login");
    name = session.user.name ?? session.user.email ?? "Signed in";
    email = session.user.email ?? null;
  } else {
    const jar = await cookies();
    if (!jar.get("mrv_dev_session")) redirect("/login");
  }

  return (
    <AppShell userName={name} userEmail={email} authenticated={ssoConfigured}>
      {children}
    </AppShell>
  );
}
