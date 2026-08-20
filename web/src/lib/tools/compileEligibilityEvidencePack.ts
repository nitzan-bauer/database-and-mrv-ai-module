import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { createGoogleDocFromDocx, updateGoogleDocFromDocx } from "../google/driveClient";
import { ensureProjectDriveFolder } from "../google/ensureProjectFolder";
import { buildEligibilityPackDocx } from "../pdd/buildEligibilityPackDocx";
import { VM0042_ELIGIBILITY_REFERENCE } from "../pdd/vm0042EligibilityReference";

export interface EligibilityActivityGroup {
  activityType: string;
  activityLabel: string | null;
  farmCount: number;
  plotCount: number;
  applications: number;
  matched: boolean;
  category?: string;
  bullet?: string;
  citation?: string;
}

export interface CompiledEligibilityPack {
  projectId: string;
  packDocId: string;
  packDocUrl: string;
  created: boolean;
  activityGroups: EligibilityActivityGroup[];
  unmatchedCount: number;
}

/**
 * Links every real, non-demo ALM activity recorded for a project
 * (mrv.alm_activities, via its plot -> farm) to the specific VM0042
 * Appendix 1 category and bullet it falls under — real supporting
 * evidence for eligibility (Applicability Condition 1) and additionality
 * (Step 3 Common Practice), the way Appendix 1 itself describes its own
 * use. An activity_type with no Appendix 1 match (only 'other' today —
 * Appendix 1 is explicitly non-exhaustive) is listed as unmatched rather
 * than guessed at, so a person decides the citation instead of the tool
 * inventing one.
 *
 * Delivered as a Drive doc, same convention as the Readiness Report:
 * created once, updated in place after, living in the project's own
 * Drive folder next to the PDD Doc.
 */
export async function compileEligibilityEvidencePack(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<CompiledEligibilityPack>> {
  const guard = requireDbMode("compileEligibilityEvidencePack");
  if (guard) return guard;

  const policy = await checkPolicy("compile_eligibility_evidence_pack", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ctx.googleAccessToken) {
    return fail("compileEligibilityEvidencePack: no Google Drive access token for this session — sign in with Drive access.");
  }

  const { query } = await import("../db");

  const projects = await query<{ name: string; eligibility_pack_doc_id: string | null }>(
    `SELECT name, eligibility_pack_doc_id FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("compileEligibilityEvidencePack: no such project.");
  const project = projects[0];

  const rows = await query<{
    activity_type: string;
    activity_label: string | null;
    farm_count: string;
    plot_count: string;
    applications: string;
  }>(
    `SELECT a.activity_type,
            p.activity_label,
            count(DISTINCT f.farm_id)::text AS farm_count,
            count(DISTINCT a.plot_id)::text AS plot_count,
            count(*)::text AS applications
       FROM mrv.alm_activities a
       JOIN mrv.plots pl ON pl.plot_id = a.plot_id
       JOIN mrv.farms f ON f.farm_id = pl.farm_id
       LEFT JOIN mrv.products p ON p.product_id = a.product_id
      WHERE f.project_id = $1 AND NOT f.is_demo AND NOT a.is_demo
      GROUP BY a.activity_type, p.activity_label
      ORDER BY a.activity_type`,
    [input.projectId],
  );

  const activityGroups: EligibilityActivityGroup[] = rows.map((r) => {
    const ref = VM0042_ELIGIBILITY_REFERENCE[r.activity_type];
    return {
      activityType: r.activity_type,
      activityLabel: r.activity_label,
      farmCount: Number(r.farm_count),
      plotCount: Number(r.plot_count),
      applications: Number(r.applications),
      matched: Boolean(ref),
      category: ref?.category,
      bullet: ref?.bullet,
      citation: ref?.citation,
    };
  });
  const unmatchedCount = activityGroups.filter((g) => !g.matched).length;

  const docxBuffer = await buildEligibilityPackDocx(project.name, activityGroups);

  let folderId: string;
  try {
    folderId = await ensureProjectDriveFolder(query, ctx.googleAccessToken, input.projectId, project.name);
  } catch (e) {
    return fail(`compileEligibilityEvidencePack: could not create the project's Drive folder — ${e instanceof Error ? e.message : e}.`);
  }

  const fileName = `Eligibility Evidence Pack — ${project.name}`;
  let packDocId: string;
  let packDocUrl: string;
  let created: boolean;

  if (project.eligibility_pack_doc_id) {
    let file;
    try {
      file = await updateGoogleDocFromDocx(ctx.googleAccessToken, project.eligibility_pack_doc_id, docxBuffer);
    } catch (e) {
      return fail(`compileEligibilityEvidencePack: could not update the existing pack — ${e instanceof Error ? e.message : e}.`);
    }
    packDocId = file.id;
    packDocUrl = file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;
    created = false;
  } else {
    let file;
    try {
      file = await createGoogleDocFromDocx(ctx.googleAccessToken, fileName, docxBuffer, folderId);
    } catch (e) {
      return fail(`compileEligibilityEvidencePack: could not create the pack — ${e instanceof Error ? e.message : e}.`);
    }
    packDocId = file.id;
    packDocUrl = file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;
    created = true;
    await query(`UPDATE mrv.projects SET eligibility_pack_doc_id = $2, eligibility_pack_doc_url = $3 WHERE project_id = $1`, [
      input.projectId,
      packDocId,
      packDocUrl,
    ]);
  }

  await audit(ctx, "compile_eligibility_evidence_pack", { type: "project", id: input.projectId }, {
    packDocId,
    created,
    activityTypeCount: activityGroups.length,
    unmatchedCount,
  });

  return ok({
    projectId: input.projectId,
    packDocId,
    packDocUrl,
    created,
    activityGroups,
    unmatchedCount,
  });
}
