import { auth } from "@/auth";
import { listPendingAgentActions } from "@/lib/data";
import { PendingApprovalsList } from "@/components/agents/PendingApprovalsList";

export const dynamic = "force-dynamic";

/** Approve or reject one pending 'confirm'-mode action, as the signed-in person. */
async function resolveAction(pendingId: string, decision: "approve" | "reject") {
  "use server";
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return { ok: false, detail: "Not signed in." };
  const { resolvePendingAgentAction } = await import("@/lib/tools/resolvePendingAgentAction");
  return resolvePendingAgentAction({
    pendingId,
    decision,
    approverEmail: session.user.email,
    googleAccessToken: session.googleAccessToken,
  });
}

/**
 * The missing half of every 'confirm'-mode action (0113's own doc
 * comment) — a real place a manager sees what an agent wanted to do and
 * either approves it (replays the exact call with ctx.confirmed=true)
 * or rejects it. Separate from /work-orders on purpose: a pending action
 * has no work-order id yet, and covers roughly a dozen action types
 * across Rebeka, Dave, and Jennifer, not just work orders.
 */
export default async function AgentApprovalsPage() {
  const actions = await listPendingAgentActions();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-pine-700">Approvals</h1>
        <p className="mt-1 text-sm text-muted">
          Every action an agent proposed that needs your click before it actually happens — issuing a work
          order, sending someone into a field, or anything else marked &quot;confirm&quot; in its policy.
          Nothing here has taken effect yet.
        </p>
      </div>
      <PendingApprovalsList actions={actions} resolve={resolveAction} />
    </div>
  );
}
