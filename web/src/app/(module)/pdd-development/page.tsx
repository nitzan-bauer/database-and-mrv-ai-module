import { auth } from "@/auth";
import { listProjects, resolveActiveProject } from "@/lib/data";
import { DATA_MODE } from "@/lib/env";
import { DevelopmentChapterBlock } from "@/components/agents/DevelopmentChapterBlock";
import { EligibilityPackPanel } from "@/components/agents/EligibilityPackPanel";
import { ProjectSwitcher } from "@/components/agents/ProjectSwitcher";
import type { ToolResult } from "@/lib/tools/context";
import type { UpdatedPddSectionStatus } from "@/lib/tools/updatePddSectionStatus";
import type { CompiledEligibilityPack } from "@/lib/tools/compileEligibilityEvidencePack";

export const dynamic = "force-dynamic";

async function updateSectionAction(input: {
  projectId: string;
  templateId: string;
  sectionIndex: number;
  status?: "pending" | "answered" | "skipped";
  inputText?: string;
  reviewComment?: string;
  devApproved?: boolean;
  structuredField?: { fieldKey: string; fieldValue: string | null };
}): Promise<ToolResult<UpdatedPddSectionStatus>> {
  "use server";
  const session = await auth().catch(() => null);
  const { updatePddSectionStatus } = await import("@/lib/tools/updatePddSectionStatus");
  return updatePddSectionStatus({ actor: session?.user?.email ?? "unknown", actorKind: "human" }, input);
}

async function compileEligibilityPackAction(input: { projectId: string }): Promise<ToolResult<CompiledEligibilityPack>> {
  "use server";
  const session = await auth().catch(() => null);
  const { compileEligibilityEvidencePack } = await import("@/lib/tools/compileEligibilityEvidencePack");
  return compileEligibilityEvidencePack(
    { actor: session?.user?.email ?? "unknown", actorKind: "human", googleAccessToken: session?.googleAccessToken },
    input,
  );
}

/**
 * PDD Development (Nitzan's own spec, live this session) — the surface
 * for taking a section from Rebeka's first draft to 100% ready for
 * Verra submission and the VVB validation audit. One chapter per
 * dropdown block; each section inside opens to 4 windows (her answer,
 * what she's missing, your comments to her, your answers to what she's
 * missing) and closes only once you've approved it and nothing is left
 * outstanding.
 *
 * Every chapter renders the same way — confirmed against the Project
 * Details chapter (plain text) and the Quantification chapter (the real
 * GHG table) before extending to the rest.
 */
export default async function PddDevelopmentPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  if (DATA_MODE !== "db") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-pine-700">PDD Development</h1>
        <p className="text-sm text-muted">Runs on the database — not available on fixtures.</p>
      </div>
    );
  }

  const { listPddSectionStatus, computeSectionNumbers } = await import("@/lib/pdd/sectionStatus");
  const { extractNeedsMarkers } = await import("@/lib/pdd/injectPddTemplate");
  const { getGhgReductionRows } = await import("@/lib/pdd/ghgReductionEstimates");
  const { SECTION_STRUCTURED_FIELDS, listStructuredFieldValues } = await import("@/lib/pdd/structuredFields");
  const { query } = await import("@/lib/db");

  const { project: requestedProjectId } = await searchParams;
  const allProjects = await listProjects();
  const project = resolveActiveProject(allProjects, requestedProjectId);
  const result = await listPddSectionStatus(query, project.projectId);

  if (!result) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-pine-700">PDD Development</h1>
        <p className="text-sm text-muted">No PDD template is registered yet — register one first.</p>
      </div>
    );
  }

  const sectionNumbers = computeSectionNumbers(result.rows);
  const l1Rows = result.rows.filter((r) => r.sectionLevel === 1);
  const l1Indexes = l1Rows.map((r) => r.sectionIndex);

  function chapterSections(chapterRow: (typeof l1Rows)[number]) {
    const pos = l1Indexes.indexOf(chapterRow.sectionIndex);
    const end = l1Indexes[pos + 1] ?? Infinity;
    return result!.rows.filter((r) => r.sectionIndex > chapterRow.sectionIndex && r.sectionIndex < end);
  }

  // Missing inputs computed once, for every chapter's sections — the
  // same extractNeedsMarkers reading used everywhere else in this app.
  const missingInputsBySection: Record<number, string[]> = {};
  for (const row of result.rows) {
    missingInputsBySection[row.sectionIndex] = extractNeedsMarkers(row.draftedText);
  }

  // The one section that's a real table, not prose: "Quantification of
  // Estimated Reductions and Removals" nested under "Estimated GHG
  // Emission Reductions and Carbon Dioxide Removals" (not the same-named
  // top-level chapter). Read the same way fillGhgReductionsTable reads it
  // for the live docx, so what's shown here can never drift from the PDD.
  const ghgTableSection = result.rows.find(
    (r) =>
      r.sectionLevel === 3 &&
      r.sectionTitle === "Quantification of Estimated Reductions and Removals" &&
      result!.rows.some(
        (p) => p.sectionIndex === r.sectionIndex - 1 && p.sectionTitle.startsWith("Estimated GHG Emission Reductions"),
      ),
  );
  const structuredValuesBySection = await listStructuredFieldValues(query, project.projectId);

  let ghgTableBySection: Record<number, Awaited<ReturnType<typeof getGhgReductionRows>>> | undefined;
  if (ghgTableSection) {
    const proj = await query<{ crediting_start: string | Date | null; crediting_end: string | Date | null }>(
      `SELECT crediting_start, crediting_end FROM mrv.projects WHERE project_id = $1`,
      [project.projectId],
    );
    const cs = proj[0]?.crediting_start;
    const ce = proj[0]?.crediting_end;
    if (cs && ce) {
      const toUtcDateOnly = (v: string | Date) =>
        v instanceof Date
          ? new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
          : new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
      const rows = await getGhgReductionRows(query, project.projectId, toUtcDateOnly(cs), toUtcDateOnly(ce));
      ghgTableBySection = { [ghgTableSection.sectionIndex]: rows };
    }
  }

  return (
    <div className="space-y-6">
      <ProjectSwitcher projects={allProjects} activeProjectId={project.projectId} basePath="/pdd-development" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pine-700">PDD Development for &quot;{project.name}&quot;</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Take each section from Rebeka&apos;s first draft to submission-ready. A section closes once you&apos;ve
            approved it and nothing is left outstanding.
          </p>
        </div>
      </div>

      <EligibilityPackPanel
        projectId={project.projectId}
        packDocUrl={project.eligibilityPackDocUrl}
        action={compileEligibilityPackAction}
      />

      {l1Rows.length ? (
        l1Rows.map((chapter, i) => (
          <DevelopmentChapterBlock
            key={chapter.statusId}
            projectId={project.projectId}
            templateId={result.templateId}
            chapterNumber={sectionNumbers[chapter.sectionIndex]}
            chapterTitle={chapter.sectionTitle}
            sections={chapterSections(chapter)}
            sectionNumbers={sectionNumbers}
            missingInputsBySection={missingInputsBySection}
            ghgTableBySection={ghgTableBySection}
            structuredFieldsBySection={SECTION_STRUCTURED_FIELDS}
            structuredValuesBySection={structuredValuesBySection}
            action={updateSectionAction}
            defaultOpen={i === 0}
          />
        ))
      ) : (
        <p className="text-sm text-muted">No chapters found in the registered template.</p>
      )}
    </div>
  );
}
