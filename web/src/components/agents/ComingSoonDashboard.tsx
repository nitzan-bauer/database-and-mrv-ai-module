/** Section 1 for every agent whose own dashboard isn't built yet — Rebeka's is live; the rest are next. */
export function ComingSoonDashboard({ agentName }: { agentName: string }) {
  return (
    <section>
      <h2 className="mb-1 text-base font-bold text-pine-700">{agentName}&apos;s dashboard</h2>
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-[13px] font-semibold text-pine-700">Not built yet.</p>
        <p className="mt-1 max-w-2xl text-[12.5px] text-muted">
          Rebeka&apos;s own dashboard is live first; the rest of the department gets its own next.
        </p>
      </div>
    </section>
  );
}
