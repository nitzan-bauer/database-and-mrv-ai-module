import { Card } from "@/components/ui/Card";
import type { AdminUser } from "@/lib/data/fixtures";

const SYSTEM_STYLE: Record<string, string> = {
  MRV: "bg-pine-50 text-pine-700",
  SaaS: "bg-verify-100 text-verify-700",
  CRM: "bg-cream text-faint",
};

const AUTH_LABEL: Record<string, string> = {
  sso: "Google SSO",
  password: "password",
  mcp_token: "MCP token",
};

const MODE_STYLE: Record<string, string> = {
  auto: "bg-sage-100 text-sage-700",
  confirm: "bg-gold-200 text-earth-600",
  off: "bg-cream text-faint",
};

export function AdminView({
  users,
  policies,
  audit,
}: {
  users: AdminUser[];
  policies: Array<{ action: string; mode: "auto" | "confirm" | "off"; note: string }>;
  audit: Array<{
    ts: string;
    actor: string;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string;
  }>;
}) {
  const bySystem = (s: string) => users.filter((u) => u.system === s).length;

  return (
    <div className="space-y-4">
      {/* the three governed systems */}
      <Card imprint className="p-5">
        <h2 className="text-sm font-semibold text-pine-700">One admin, three systems</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SystemCard
            name="MRV module"
            state="live"
            detail={`${bySystem("MRV")} identities · this database`}
          />
          <SystemCard
            name="CarboNature SaaS"
            state="pulled"
            detail={`${bySystem("SaaS")} identities · farmers and credit buyers`}
          />
          <SystemCard name="In-house CRM" state="tier 3" detail="plugs into the same system" />
        </div>
        <p className="mt-3 border-t border-line pt-2.5 text-[12px] text-muted">
          The module connects to the SaaS admin and governs it from here, so a user, role or
          permission is defined once rather than maintained twice and drifting.
        </p>
      </Card>

      {/* users */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-pine-700">Users &amp; roles · {users.length}</h2>
          <p className="font-mono text-[10.5px] text-faint">
            mrv.users + mrv.project_memberships, and the SaaS identities pulled alongside them
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-cream text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                {["User", "Role", "Scope", "Sign-in", "System", "Last active"].map((h) => (
                  <th key={h} className="px-4 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{u.name}</div>
                    <div className="font-mono text-[10.5px] text-faint">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{u.role}</td>
                  <td className="px-4 py-2.5 text-muted">{u.scope}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        "rounded-md px-1.5 py-0.5 font-mono text-[10px] " +
                        (u.authMethod === "mcp_token"
                          ? "bg-gold-200 text-earth-600"
                          : "bg-cream text-muted")
                      }
                    >
                      {AUTH_LABEL[u.authMethod]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                        SYSTEM_STYLE[u.system]
                      }
                    >
                      {u.system}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-muted">
                    {u.lastActiveAt ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* agent policies */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-agent-700">Agent action policies</h2>
            <p className="font-mono text-[10.5px] text-faint">
              mrv.agent_action_policies · what Dave may do without asking
            </p>
          </div>
          <ul>
            {policies.map((p) => (
              <li key={p.action} className="flex items-start gap-3 border-t border-line px-4 py-2.5">
                <span
                  className={
                    "mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                    MODE_STYLE[p.mode]
                  }
                >
                  {p.mode}
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[12px] font-medium text-ink">{p.action}</p>
                  <p className="text-[11.5px] leading-snug text-muted">{p.note}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
            Anything that creates an artifact defaults to <b>confirm</b>. An agent that can act
            unsupervised is only safe where the action is read-only.
          </p>
        </Card>

        {/* audit log */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-pine-700">Audit log</h2>
            <p className="font-mono text-[10.5px] text-faint">
              mrv.audit_log · actor, action, target, timestamp — append-only
            </p>
          </div>
          <ul className="max-h-[340px] overflow-auto">
            {audit.map((a, i) => (
              <li key={i} className="border-t border-line px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-ink">{a.action}</span>
                  <span className="font-mono text-[10px] text-faint">
                    {a.ts.replace("T", " ").replace("Z", "")}
                  </span>
                </div>
                <p className="font-mono text-[10.5px] text-muted">
                  {a.actor}{" "}
                  <span className="text-faint">({a.actorRole})</span> → {a.targetType}{" "}
                  <b className="text-pine-700">{a.targetId}</b>
                </p>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
            The table rejects UPDATE and DELETE by trigger. A correction is a new row, never an
            edit — which is what makes the trail evidence rather than a record of the last opinion.
          </p>
        </Card>
      </div>

      {/* the rest of the admin surface */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-pine-700">Also governed here</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["SSO & security", "Google Workspace, MFA, lockout"],
            ["MCP tokens", "issue, scope, revoke · window + 14 days"],
            ["Model licences", "DNDC v9.x, DayCent v6.x"],
            ["Lab integrations", "accreditation flags drive a hard check"],
            ["Storage (S3)", "KMS, Glacier after 2 yr, 10-yr retention"],
            ["Retention policy", "project lifetime + 5 years"],
            ["Parameter sets", "versioned; UPDATE rejected"],
            ["Demo-data interlock", "demo rows cannot reach real projects"],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-xl border border-line bg-cream/50 px-3.5 py-2.5">
              <p className="text-[12.5px] font-semibold text-ink">{title}</p>
              <p className="text-[11px] leading-snug text-muted">{detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10.5px] text-faint">
          read-only in demo-data mode · writes are enabled against the live database
        </p>
      </Card>
    </div>
  );
}

function SystemCard({
  name,
  state,
  detail,
}: {
  name: string;
  state: "live" | "pulled" | "tier 3";
  detail: string;
}) {
  const tone =
    state === "live"
      ? "border-pine-600/40 bg-pine-50"
      : state === "pulled"
        ? "border-verify-500/30 bg-verify-100/50"
        : "border-line bg-cream/60";
  return (
    <div className={"rounded-xl border px-3.5 py-3 " + tone}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">{name}</p>
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{state}</span>
      </div>
      <p className="mt-0.5 text-[11.5px] text-muted">{detail}</p>
    </div>
  );
}
