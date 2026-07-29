import { AppShell } from "@/components/app/AppShell";

/**
 * The internal module chrome. Everything under (module) is for signed-in
 * staff; the login page and the token-gated sampler view sit outside it and
 * deliberately show no navigation or user identity.
 */
export default function ModuleLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
