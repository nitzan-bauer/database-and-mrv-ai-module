/**
 * PDD readiness gauge — the "clock" from the development plan. Pure SVG,
 * no client JS needed: this is a static read of the questionnaire's
 * current answered/total, not something a person interacts with here
 * (answering happens on the questionnaire page itself).
 */
export function ReadinessGauge({ pct, label }: { pct: number; label: string }) {
  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const color = pct >= 80 ? "#5B8C6E" : pct >= 40 ? "#C9A227" : "#B5734A";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4">
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
          className="font-mono text-[18px] font-bold"
          fill="#1A3A3A"
        >
          {pct}%
        </text>
      </svg>
      <div>
        <p className="text-[13px] font-bold text-pine-700">PDD Readiness Progress</p>
        <p className="mt-0.5 text-[11.5px] text-faint">{label}</p>
      </div>
    </div>
  );
}
