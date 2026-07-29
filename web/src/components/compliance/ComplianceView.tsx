import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { CCP_CONDITION, type ComplianceScore } from "@/lib/compliance/evaluate";

const RESULT_STYLE: Record<string, string> = {
  pass: "bg-sage-100 text-sage-700",
  fail: "bg-danger/10 text-danger",
  warn: "bg-gold-200 text-earth-600",
  planned: "bg-cream text-faint",
  not_applicable: "bg-cream text-faint",
};

const WHERE_LABEL: Record<string, string> = {
  database: "enforced in the database",
  module: "evaluated in the module",
  planned: "not built yet",
};

export function ComplianceView({
  farms,
  activeFarmId,
  cycleLabel,
  result,
}: {
  farms: Array<{ farmId: string; name: string }>;
  activeFarmId: string;
  cycleLabel: string;
  result: ComplianceScore;
}) {
  const failing = result.checks.filter((c) => c.result === "fail");
  const tone =
    result.score === 100 ? "sage" : result.score >= 70 ? "gold" : "danger";
  const toneClass =
    tone === "sage" ? "text-sage-600" : tone === "gold" ? "text-gold-600" : "text-danger";
  const ringClass =
    tone === "sage" ? "stroke-sage-400" : tone === "gold" ? "stroke-gold-500" : "stroke-danger";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {farms.map((f) => (
          <Link
            key={f.farmId}
            href={`/compliance?farm=${f.farmId}`}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (f.farmId === activeFarmId
                ? "bg-pine-600 text-white"
                : "border border-line bg-white text-pine-700 hover:bg-pine-50")
            }
          >
            {f.name}
          </Link>
        ))}
        <span className="ml-auto font-mono text-[11px] text-faint">{cycleLabel}</span>
      </div>

      {/* score */}
      <Card imprint className="p-6">
        <div className="flex flex-wrap items-center gap-8">
          <Dial score={result.score} ringClass={ringClass} toneClass={toneClass} />
          <div className="min-w-[220px] flex-1">
            <p className="text-sm font-semibold text-pine-700">
              {result.hardPassed} of {result.hardTotal} hard checks pass
              {result.warnings > 0 && ` · ${result.warnings} warning${result.warnings === 1 ? "" : "s"}`}
            </p>
            {failing.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {failing.map((c) => (
                  <li key={c.code} className="text-[13px] text-danger">
                    ✕ {c.label} — <span className="text-muted">{c.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-muted">
                Every hard check passes. Warnings reduce the score by 5 each but never block.
              </p>
            )}
            <p className="mt-3 font-mono text-[10.5px] text-faint">
              A hard failure caps the score below 100 regardless of warnings.
            </p>
          </div>
        </div>
      </Card>

      {/* checks */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-pine-700">Checks</h2>
          <p className="font-mono text-[11px] text-faint">
            each rule with its VM0042 reference and where it is evaluated
          </p>
        </div>
        <ul>
          {result.checks.map((c) => (
            <li key={c.code} className="flex items-start gap-3 border-t border-line px-4 py-3">
              <span
                className={
                  "mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold " +
                  RESULT_STYLE[c.result]
                }
              >
                {c.result === "not_applicable" ? "n/a" : c.result}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">
                  {c.label}{" "}
                  <span className="font-mono text-[10.5px] text-faint">{c.ref}</span>
                </p>
                <p className="text-[12px] text-muted">{c.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-[10px] text-faint">{c.code}</p>
                <p className="font-mono text-[9.5px] text-faint">{WHERE_LABEL[c.enforcedIn]}</p>
                {!c.isHard && (
                  <p className="font-mono text-[9.5px] text-gold-600">soft</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* CCP */}
      <Card className="border-l-4 border-l-agent-500 p-5">
        <h2 className="text-sm font-semibold text-agent-700">{CCP_CONDITION.label}</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">{CCP_CONDITION.detail}</p>
        <p className="mt-2 font-mono text-[10.5px] text-faint">{CCP_CONDITION.ref}</p>
      </Card>
    </div>
  );
}

function Dial({
  score,
  ringClass,
  toneClass,
}: {
  score: number;
  ringClass: string;
  toneClass: string;
}) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const dash = (score / 100) * circumference;
  return (
    <div className="relative h-[140px] w-[140px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} className="fill-none stroke-line" strokeWidth="14" />
        <circle
          cx="70"
          cy="70"
          r={r}
          className={"fill-none " + ringClass}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={"text-3xl font-bold tabular-nums " + toneClass}>{score}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">score</span>
      </div>
    </div>
  );
}
