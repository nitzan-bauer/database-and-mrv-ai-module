import Link from "next/link";
import { listProjects, listWorkOrders } from "@/lib/data";
import { Card } from "@/components/ui/Card";
import { tokenState, daysUntil } from "@/lib/mcp/token";

export const dynamic = "force-dynamic";

const STATE_STYLE: Record<string, string> = {
  draft: "bg-cream text-muted",
  sent: "bg-verify-100 text-verify-700",
  in_progress: "bg-gold-200 text-earth-600",
  completed: "bg-sage-100 text-sage-700",
  closed: "bg-cream text-faint",
};

export default async function WorkOrdersPage() {
  const [project] = await listProjects();
  const orders = await listWorkOrders(project.projectId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Work orders</h1>
        <p className="mt-1 text-sm text-muted">
          The bridge from an approved cycle to a contractor in the field: a printable PDF, an email,
          and a one-tap MCP activation token.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                {["Work order", "Farm", "Cycle", "Window", "Points", "Token", "State", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((w) => {
                const st = w.token ? tokenState(w.token) : null;
                const left = w.token ? daysUntil(w.token.expiresAt) : 0;
                return (
                  <tr key={w.woId} className="border-t border-line">
                    <td className="px-4 py-2.5 font-mono text-xs">{w.woId}</td>
                    <td className="px-4 py-2.5">{w.farmName}</td>
                    <td className="px-4 py-2.5 text-muted">
                      C{w.cycleNumber} · {w.approach}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">
                      {w.windowStart} → {w.windowEnd}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-pine-700 tabular-nums">
                      {w.points.length}
                    </td>
                    <td className="px-4 py-2.5">
                      {st ? (
                        <span
                          className={
                            "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                            (st === "active"
                              ? "bg-sage-100 text-sage-700"
                              : st === "expired"
                                ? "bg-cream text-faint"
                                : "bg-gold-200 text-earth-600")
                          }
                        >
                          {st === "active" ? `active · ${left}d` : st}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-faint">not issued</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                          (STATE_STYLE[w.state] ?? "bg-cream text-muted")
                        }
                      >
                        {w.state.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/work-orders/${w.woId}`}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-pine-700 hover:bg-pine-50"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
