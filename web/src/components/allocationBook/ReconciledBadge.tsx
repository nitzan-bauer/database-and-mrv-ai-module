export function ReconciledBadge({ reconciled, discrepancy }: { reconciled: boolean; discrepancy: number }) {
  if (reconciled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-3 py-1 text-[12.5px] font-semibold text-ok">
        <span aria-hidden>✓</span> RECONCILED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1 text-[12.5px] font-semibold text-danger">
      <span aria-hidden>⚠</span> NOT RECONCILED — discrepancy {Math.abs(discrepancy).toFixed(2)} VCU
    </span>
  );
}
