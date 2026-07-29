import {
  DEMO_ADMIN_USERS,
  DEMO_AGENT_POLICIES,
  DEMO_AUDIT,
} from "@/lib/data/fixtures";
import { AdminView } from "@/components/admin/AdminView";

export const dynamic = "force-dynamic";

/**
 * Screen 8 — Unified Admin (spec §6.8). Not a module-only admin: it is the
 * authoritative permissions system for the MRV module, the CarboNature SaaS,
 * and the in-house CRM when it arrives. A user, role or permission is defined
 * once and applies everywhere, which is the whole point of unifying it.
 */
export default async function AdminPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Admin</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          One permissions-and-admin system governing the MRV module, the CarboNature SaaS, and the
          in-house CRM to come. Defined once, applied everywhere — and every action here lands in
          the append-only audit log.
        </p>
      </div>
      <AdminView
        users={DEMO_ADMIN_USERS}
        policies={DEMO_AGENT_POLICIES}
        audit={DEMO_AUDIT}
      />
    </div>
  );
}
