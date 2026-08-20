import { pddReadiness } from "@/lib/data";
import { ChapterReadinessBars } from "./ChapterReadinessBars";
import { ReadinessGauge } from "./ReadinessGauge";

/**
 * Section 1 (Nitzan's own spec) for Rebeka's own page: the PDD-readiness
 * picture that already exists on the main /agents dashboard, pulled out
 * onto her page as its own real, DB-backed view — not a second, invented
 * one. Same figures the main dashboard's "PDD readiness — Rebeka" section
 * reads, same X/Y-count discipline (a count over real rows, never a status
 * field that can drift).
 */
export async function RebekaDashboard({ projectId }: { projectId: string }) {
  const { query } = await import("@/lib/db");
  const { listPddSectionStatus, summarizeByChapter } = await import("@/lib/pdd/sectionStatus");

  const [readiness, questionnaire] = await Promise.all([
    pddReadiness(projectId),
    listPddSectionStatus(query, projectId),
  ]);

  const answered = questionnaire?.rows.filter((r) => r.status === "answered").length ?? 0;
  const drafted = questionnaire?.rows.filter((r) => r.status === "drafted").length ?? 0;
  const pct = questionnaire?.rows.length ? Math.round((answered / questionnaire.rows.length) * 100) : 0;
  const chapterReadiness = questionnaire ? summarizeByChapter(questionnaire.rows) : [];

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-bold text-pine-700">Rebeka&apos;s dashboard — PDD readiness</h2>
        <a
          href={`/pdd-development?project=${encodeURIComponent(projectId)}`}
          className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-pine-700 hover:bg-cream"
        >
          Open PDD Development →
        </a>
      </div>
      <p className="mb-3 max-w-3xl text-[13px] text-muted">
        The small set of things Rebeka is responsible for regardless of template version: described
        farms, clean boundaries, a defined baseline, an evaluated cycle — each figure a count over
        real rows, not a status a person has to remember to update.
      </p>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        {questionnaire && (
          <ReadinessGauge
            pct={pct}
            label={`${answered}/${questionnaire.rows.length} confirmed` + (drafted ? ` · ${drafted} AI-drafted` : "")}
          />
        )}
        <ChapterReadinessBars
          chapters={chapterReadiness}
          overall={questionnaire ? { total: questionnaire.rows.length, answered, drafted } : undefined}
        />
      </div>

      {readiness.items.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
          {readiness.items.map((it, i) => {
            const complete = it.total > 0 && it.ready === it.total;
            return (
              <div key={it.key} className={"px-4 py-2.5 " + (i > 0 ? "border-t border-line" : "")}>
                <div className="flex items-baseline gap-3">
                  <span className="w-44 shrink-0 text-[13px] font-semibold text-pine-700">{it.label}</span>
                  <span
                    className={
                      "w-16 shrink-0 text-right font-mono text-[15px] font-bold " +
                      (complete ? "text-sage-700" : it.ready > 0 ? "text-earth-600" : "text-faint")
                    }
                  >
                    {it.ready}/{it.total}
                  </span>
                  <span className="text-[11.5px] text-faint">{it.detail}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
