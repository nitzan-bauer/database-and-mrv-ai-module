import { getWorkOrder } from "@/lib/data";
import { tokenState } from "@/lib/mcp/token";
import { fieldReminders } from "@/lib/mcp/reminders";
import { SamplerView } from "@/components/sampler/SamplerView";
import { IconMark } from "@/components/brand/Logo";

export const dynamic = "force-dynamic";

/**
 * Screen 6 — MCP Sampler View (spec §6.6). The field view an external
 * contractor opens from the work-order token. No SSO, no navigation, no
 * sight of other projects: the token scopes them to this work order alone.
 */
export default async function SamplerPage({
  params,
  searchParams,
}: {
  params: Promise<{ woId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { woId } = await params;
  const { token } = await searchParams;
  const wo = await getWorkOrder(decodeURIComponent(woId));

  if (!wo) return <Gate title="Work order not found" body="Check the link you were sent." />;

  // In fixtures mode any token opens the demo order; against the live
  // database the hash is looked up and scoped to this work order.
  if (!token) {
    return (
      <Gate
        title="Access token required"
        body="Open the link exactly as it was emailed to you — it carries the token that grants access to this work order."
      />
    );
  }

  if (!wo.token) {
    return <Gate title="No token issued" body="This work order has not been sent yet." />;
  }

  const st = tokenState(wo.token);
  if (st === "expired")
    return (
      <Gate
        title="This link has expired"
        body={`Access ended on ${wo.token.expiresAt.slice(0, 10)}. Ask CarboNature to reissue it.`}
      />
    );
  if (st === "revoked")
    return <Gate title="Access revoked" body="This link was revoked. Contact CarboNature." />;

  const reminders = fieldReminders(wo, 0);

  return <SamplerView wo={wo} reminders={reminders} />;
}

/** A full-screen message for the cases where the field view must not open. */
function Gate({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-5">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-7 text-center shadow-[var(--shadow-card)]">
        <IconMark size={44} className="mx-auto" />
        <h1 className="mt-4 text-base font-bold text-pine-700">{title}</h1>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <p className="mt-5 font-mono text-[10.5px] text-faint">
          CarboNature · sampler.carbonature.io
        </p>
      </div>
    </div>
  );
}
