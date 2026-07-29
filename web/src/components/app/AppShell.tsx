import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { DATA_MODE } from "@/lib/env";

const NAV = [
  { href: "/projects", label: "Projects" },
  { href: "/map", label: "Map" },
  { href: "/plans", label: "Plans" },
  { href: "/work-orders", label: "Work orders" },
  { href: "/admin", label: "Admin" },
];

/** The MRV module chrome: sticky brand header + centered content column. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo width={150} href="/projects" priority />
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-pine-50 hover:text-pine-700"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <DataModeBadge />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-pine-700">Nitzan Bauer</p>
              <p className="text-xs text-muted">Super Admin</p>
            </div>
            <span className="rounded-full bg-sage-100 px-2.5 py-1 text-xs font-medium text-sage-700">
              Active
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-line px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-faint">
          <span>CarboNature · AI Soil MRV Module · Tier 1</span>
          <span>VM0042 v2.2 · ICVCM CCP</span>
        </div>
      </footer>
    </div>
  );
}

function DataModeBadge() {
  const live = DATA_MODE === "db";
  return (
    <span
      title={live ? "Connected to the live mrv database" : "Demo data — no database connection"}
      className={
        "rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold " +
        (live ? "bg-verify-100 text-verify-700" : "bg-gold-200 text-earth-600")
      }
    >
      {live ? "● live DB" : "● demo data"}
    </span>
  );
}
