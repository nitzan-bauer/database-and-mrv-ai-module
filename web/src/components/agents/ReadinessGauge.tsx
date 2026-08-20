/**
 * PDD readiness gauge — the "clock" from the development plan. Pure SVG,
 * no client JS needed: this is a static read of the questionnaire's
 * current answered/total, not something a person interacts with here
 * (answering happens on the questionnaire page itself).
 *
 * Bare — no card, no title of its own. Nitzan's own follow-up: the gauge
 * and the per-chapter bars are one unit, titled once with the project's
 * own name, at the gauge's own (narrow) width — not a full-width card of
 * its own. The parent (RebekaDashboard) supplies that single wrapper.
 * Centered and enlarged (a second follow-up) so it reads as the one
 * headline number of the card, not a small icon beside its own caption.
 */
export function ReadinessGauge({ pct, label, size = 108 }: { pct: number; label: string; size?: number }) {
  const stroke = Math.round(size * 0.1);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const color = pct >= 80 ? "#5B8C6E" : pct >= 40 ? "#C9A227" : "#B5734A";
  const fontSize = Math.round(size * 0.24);

  return (
    <div className="flex flex-col items-center text-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EFEAE0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
        <text
          x={size / 2}
          y={size / 2}
          transform={`rotate(90 ${size / 2} ${size / 2})`}
          textAnchor="middle"
          dominantBaseline="middle"
          className="font-mono font-bold"
          style={{ fontSize }}
          fill="#1A3A3A"
        >
          {pct}%
        </text>
      </svg>
      <p className="mt-2 text-[11px] leading-snug text-faint">{label}</p>
    </div>
  );
}
