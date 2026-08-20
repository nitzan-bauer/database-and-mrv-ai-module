/**
 * Per-chapter readiness, under the overall clock — Nitzan's own request:
 * the single gauge tells you the whole PDD's state, this tells you which
 * chapter still needs the work. Two-tone bar, same language as the PDD
 * Readiness Report doc: confirmed (CarboNature's brand green, full at
 * 100%) and AI-drafted-but-unreviewed (gold) are shown separately, since
 * collapsing them into one number would overstate what's actually done.
 *
 * `overall` is a second explicit ask: the readiness clock is a number,
 * not a bar you can visually compare against the chapters above it. This
 * renders that same aggregate as a bar — thicker and in the brand
 * primary (pine), not the chapter rows' sage, so it reads as the one
 * that sums up the rest rather than one more row in the list.
 */
export function ChapterReadinessBars({
  chapters,
  overall,
}: {
  chapters: Array<{ chapterTitle: string; total: number; answered: number; drafted: number }>;
  overall?: { total: number; answered: number; drafted: number };
}) {
  if (!chapters.length) return null;

  const overallAnsweredPct = overall?.total ? Math.round((overall.answered / overall.total) * 100) : 0;
  const overallDraftedPct = overall?.total ? Math.round((overall.drafted / overall.total) * 100) : 0;

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h3 className="mb-3 text-[13px] font-bold text-pine-700">PDD readiness by chapter</h3>
      <div className="space-y-2.5">
        {chapters.map((c) => {
          const answeredPct = c.total ? Math.round((c.answered / c.total) * 100) : 0;
          const draftedPct = c.total ? Math.round((c.drafted / c.total) * 100) : 0;
          return (
            <div key={c.chapterTitle}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium text-ink">{c.chapterTitle}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {answeredPct}%{c.drafted > 0 && ` · +${draftedPct}% drafted`}
                </span>
              </div>
              <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-cream">
                <div className="h-full bg-sage-400" style={{ width: `${answeredPct}%` }} />
                <div className="h-full bg-gold-400" style={{ width: `${draftedPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {overall && (
        <div className="mt-4 border-t border-line pt-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-bold text-pine-700">Overall PDD readiness</span>
            <span className="shrink-0 font-mono text-[12px] font-bold text-pine-700">
              {overallAnsweredPct}%{overall.drafted > 0 && ` · +${overallDraftedPct}% drafted`}
            </span>
          </div>
          <div className="mt-1.5 flex h-4 overflow-hidden rounded-full bg-cream ring-1 ring-line-2">
            <div className="h-full bg-pine-600" style={{ width: `${overallAnsweredPct}%` }} />
            <div className="h-full bg-gold-500" style={{ width: `${overallDraftedPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
