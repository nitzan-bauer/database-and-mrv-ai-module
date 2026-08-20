import { pddReadiness } from "@/lib/data";
import type { ToolResult } from "@/lib/tools/context";
import type { ProjectStatus } from "@/lib/tools/submitProjectStatus";
import type { SubmittedProjectStatus } from "@/lib/tools/submitProjectStatus";
import type { UpdatedPddSeedAnswer } from "@/lib/tools/updatePddSeedAnswer";
import type { PddGeneratorPipelineResult } from "@/lib/tools/runPddGeneratorPipeline";
import { ChapterReadinessBars } from "./ChapterReadinessBars";
import { ReadinessGauge } from "./ReadinessGauge";
import { SeedQuestionnaireBlock } from "./SeedQuestionnaireBlock";
import { ProjectStatusPanel } from "./ProjectStatusPanel";

type SaveAnswerAction = (input: { projectId: string; questionKey: string; answerText: string }) => Promise<ToolResult<UpdatedPddSeedAnswer>>;
type RunGeneratorAction = (input: { projectId: string }) => Promise<ToolResult<PddGeneratorPipelineResult>>;
type SubmitStatusAction = (input: { projectId: string; status: ProjectStatus }) => Promise<ToolResult<SubmittedProjectStatus>>;

/**
 * Section 1 (Nitzan's own spec) for Rebeka's own page — and, per his
 * follow-up ("all the PDD-related blocks move to Rebeka's screen,
 * including the readiness clock at the top"), now the ONLY place any of
 * this lives: the readiness gauge, the per-chapter bars, the SEED
 * questionnaire, the farm-level readiness list, the project-status panel
 * and the Google Doc sync — all of it pulled off the main department
 * dashboard, which no longer shows any PDD content at all.
 */
export async function RebekaDashboard({
  projectId,
  currentStatus,
  pddGeneratorLockedAt,
  saveAnswerAction,
  runGeneratorAction,
  submitStatusAction,
}: {
  projectId: string;
  currentStatus: ProjectStatus;
  pddGeneratorLockedAt: string | null;
  saveAnswerAction: SaveAnswerAction;
  runGeneratorAction: RunGeneratorAction;
  submitStatusAction: SubmitStatusAction;
}) {
  const { query } = await import("@/lib/db");
  const { listPddSectionStatus, summarizeByChapter } = await import("@/lib/pdd/sectionStatus");
  const { listSeedAnswers } = await import("@/lib/pdd/seedAnswers");

  const [readiness, questionnaire, seedState] = await Promise.all([
    pddReadiness(projectId),
    listPddSectionStatus(query, projectId),
    listSeedAnswers(query, projectId),
  ]);

  const answered = questionnaire?.rows.filter((r) => r.status === "answered").length ?? 0;
  const drafted = questionnaire?.rows.filter((r) => r.status === "drafted").length ?? 0;
  const pct = questionnaire?.rows.length ? Math.round((answered / questionnaire.rows.length) * 100) : 0;
  const chapterReadiness = questionnaire ? summarizeByChapter(questionnaire.rows) : [];

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-bold text-pine-700">Rebeka&apos;s dashboard — PDD readiness</h2>
        <div className="flex items-center gap-2">
          <a
            href={`/api/pdd/${encodeURIComponent(projectId)}/export`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-pine-600 bg-white px-3 py-1.5 text-[12px] font-bold text-pine-700 hover:bg-pine-50"
          >
            Download Drafted PDD
          </a>
          <a
            href={`/pdd-development?project=${encodeURIComponent(projectId)}`}
            className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-pine-700 hover:bg-cream"
          >
            Open PDD Development →
          </a>
        </div>
      </div>

      <div className="max-w-sm rounded-xl border border-line bg-white p-4">
        <h3 className="mb-3 truncate text-[13px] font-bold text-pine-700">{seedState.projectName ?? "This project"}</h3>
        {questionnaire && (
          <div className="flex justify-center">
            <ReadinessGauge
              pct={pct}
              label={`${answered}/${questionnaire.rows.length} confirmed` + (drafted ? ` · ${drafted} AI-drafted` : "")}
            />
          </div>
        )}
        <div className="mt-3">
          <ChapterReadinessBars
            chapters={chapterReadiness}
            overall={questionnaire ? { total: questionnaire.rows.length, answered, drafted } : undefined}
          />
        </div>
      </div>

      <div className="mt-4">
        <SeedQuestionnaireBlock
          projectId={projectId}
          projectName={seedState.projectName}
          rows={seedState.rows}
          autoFacts={seedState.autoFacts}
          pendingCount={seedState.pendingCount}
          lockedAt={pddGeneratorLockedAt}
          saveAnswerAction={saveAnswerAction}
          runGeneratorAction={runGeneratorAction}
        />
      </div>

      <p className="mt-4 mb-3 max-w-3xl text-[13px] text-muted">
        Not a check against the wording of any one template — that would mean assuming what an
        arbitrary section title requires, which is exactly what storing the template as data was
        meant to avoid. This is the small set of things Rebeka is responsible for regardless of
        template version: described farms, clean boundaries, a defined baseline, an evaluated
        cycle.
      </p>
      {readiness.template && (
        <p className="mb-3 font-mono text-[11px] text-faint">
          template on file: {readiness.template.name} {readiness.template.version} ·{" "}
          {readiness.template.sectionCount} sections · registered{" "}
          {new Date(readiness.template.registeredAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
        </p>
      )}
      {readiness.items.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-[13px] font-semibold text-pine-700">No farms in this project yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
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

      <div className="mt-3">
        <ProjectStatusPanel projectId={projectId} currentStatus={currentStatus} action={submitStatusAction} />
      </div>
    </section>
  );
}
