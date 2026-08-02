import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export interface GeneratedPddDraft {
  draftId: string;
  projectId: string;
  templateName: string;
  templateVersion: string;
  sectionsTotal: number;
  sectionsFilled: number;
  content: string;
}

interface TemplateSection {
  level: number;
  title: string;
  body: string;
}

/**
 * Assemble a PDD draft — Rebeka's pdd_generator skill.
 *
 * This does NOT try to decide which real data belongs under which
 * template heading. `pddReadiness` already made that call once for this
 * codebase: guessing what an arbitrary section title requires would mean
 * assuming a specific template's wording, and the whole reason the
 * template is stored as data (migration 0027) is that its wording is not
 * assumed. A future template revision must not silently break this by
 * renaming a heading this code was quietly keying off of.
 *
 * So the draft has two honest parts instead:
 *
 *   1. The template's own outline, reproduced in order, with whatever
 *      guidance text Verra wrote under each heading — nothing invented,
 *      quoting the source document's own instructions back so a person
 *      knows what each section is for.
 *   2. One annex of real, verified project facts — farms, plot validity,
 *      baseline sites, the latest additionality assessment, the latest
 *      compliance score — every figure a live query, sourced and dated,
 *      for a person to transcribe into the right narrative section
 *      themselves. Nothing here is written as if it were already the
 *      section's content.
 *
 * `sectionsFilled` counts sections whose template guidance text is
 * present (so at least something is known about what belongs there) —
 * not sections whose content this tool wrote, because it wrote none.
 */
export async function generatePddDraft(
  ctx: ToolContext,
  input: { projectId: string },
): Promise<ToolResult<GeneratedPddDraft>> {
  const guard = requireDbMode("generatePddDraft");
  if (guard) return guard;

  const policy = await checkPolicy("generate_pdd_draft", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  const { query } = await import("../db");

  const projects = await query<{ name: string; methodology: string; country: string; is_grouped: boolean; status: string }>(
    `SELECT name, methodology, country, is_grouped, status FROM mrv.projects WHERE project_id = $1`,
    [input.projectId],
  );
  if (!projects.length) return fail("generatePddDraft: no such project.");
  const project = projects[0];

  const templates = await query<{ template_id: string; name: string; version: string; structure: TemplateSection[] }>(
    `SELECT template_id, name, version, structure FROM mrv.pdd_templates ORDER BY registered_at DESC LIMIT 1`,
  );
  if (!templates.length) {
    return fail("generatePddDraft: no PDD template is registered yet — register one first.");
  }
  const template = templates[0];

  const farms = await query<{
    farm_id: string;
    name: string;
    climate_zone: string | null;
    irrigation_method: string | null;
    plot_count: string;
    valid_plot_count: string;
    total_area_ha: string | null;
  }>(
    `SELECT f.farm_id, f.name, f.climate_zone, f.irrigation_method,
            count(p.plot_id)::text plot_count,
            count(p.plot_id) FILTER (WHERE ST_IsValid(p.geom))::text valid_plot_count,
            sum(p.area_ha)::text total_area_ha
       FROM mrv.farms f LEFT JOIN mrv.plots p ON p.farm_id = f.farm_id
      WHERE f.project_id = $1
      GROUP BY f.farm_id, f.name, f.climate_zone, f.irrigation_method
      ORDER BY f.name`,
    [input.projectId],
  );

  const baseline = await query<{ farm_id: string; n: string; avg_area: string | null; avg_distance: string | null }>(
    `SELECT farm_id, count(*)::text n, avg(area_ha)::text avg_area, avg(distance_km)::text avg_distance
       FROM mrv.baseline_control_sites WHERE farm_id = ANY($1::uuid[]) GROUP BY farm_id`,
    [farms.map((f) => f.farm_id)],
  );
  const baselineByFarm = new Map(baseline.map((b) => [b.farm_id, b]));

  const compliance = await query<{ farm_id: string; score: number; evaluated_at: string }>(
    `SELECT DISTINCT ON (farm_id) farm_id, score, evaluated_at
       FROM mrv.compliance_scores WHERE farm_id = ANY($1::uuid[])
      ORDER BY farm_id, evaluated_at DESC`,
    [farms.map((f) => f.farm_id)],
  );
  const complianceByFarm = new Map(compliance.map((c) => [c.farm_id, c]));

  const additionality = await query<{
    regulatory_surplus_met: boolean;
    barriers: unknown[];
    common_practice_region: string;
    common_practice_adoption_pct: string | null;
    step4c_demonstrated: boolean;
    assessed_at: string;
  }>(
    `SELECT regulatory_surplus_met, barriers, common_practice_region, common_practice_adoption_pct,
            step4c_demonstrated, assessed_at
       FROM mrv.additionality_assessments WHERE project_id = $1
      ORDER BY assessed_at DESC LIMIT 1`,
    [input.projectId],
  );

  /* ── part 1: the template's own outline ─────────────────────────── */
  const lines: string[] = [];
  lines.push(`# ${template.name} ${template.version} — draft for ${project.name}`);
  lines.push(`_Generated ${new Date().toISOString()} by ${ctx.actor}. This is a draft skeleton, not a submittable document._`);
  lines.push("");

  let sectionsFilled = 0;
  for (const s of template.structure) {
    lines.push(`${"#".repeat(Math.min(s.level + 1, 6))} ${s.title}`);
    if (s.body?.trim()) {
      sectionsFilled++;
      lines.push(`> Template guidance: ${s.body.trim()}`);
    } else {
      lines.push(`_[No guidance text captured for this section — see the source template.]_`);
    }
    lines.push("_[NEEDS NARRATIVE — no data-driven content is written here; see Annex A for verified facts to draw on.]_");
    lines.push("");
  }

  /* ── part 2: verified facts, not slotted into any section ──────── */
  lines.push("# Annex A — Verified Project Facts");
  lines.push(
    `_Every figure below is a live database query as of ${new Date().toISOString()}, not authored text — use it to write the sections above, do not paste it in as-is._`,
  );
  lines.push("");
  lines.push(
    `**Project**: ${project.name} · ${project.methodology} · ${project.country} · ` +
      `${project.is_grouped ? "grouped" : "single"} project · status ${project.status}`,
  );
  lines.push("");
  lines.push("**Farms**:");
  for (const f of farms) {
    const b = baselineByFarm.get(f.farm_id);
    const c = complianceByFarm.get(f.farm_id);
    lines.push(
      `- ${f.name}: ${f.climate_zone ?? "climate zone not set"}, ` +
        `${f.irrigation_method ?? "irrigation method not set"}, ` +
        `${f.valid_plot_count}/${f.plot_count} plot boundaries valid, ` +
        `${f.total_area_ha ? Number(f.total_area_ha).toFixed(2) : "0"} ha total` +
        (b ? `, ${b.n} baseline control site(s) (avg ${Number(b.avg_area).toFixed(1)} ha, avg ${Number(b.avg_distance).toFixed(1)} km away)` : ", no baseline control sites recorded yet") +
        (c ? `, compliance score ${c.score}/100 (${new Date(c.evaluated_at).toLocaleDateString("en-GB")})` : ", not yet compliance-scored"),
    );
  }
  lines.push("");
  lines.push("**Additionality (VM0042 §7)**:");
  if (additionality.length) {
    const a = additionality[0];
    const adoptionPct = a.common_practice_adoption_pct != null ? Number(a.common_practice_adoption_pct) : null;
    lines.push(
      `- Regulatory surplus: ${a.regulatory_surplus_met ? "met" : "not met"}. ` +
        `Barrier analysis: ${a.barriers.length} barrier(s) identified. ` +
        `Common practice in ${a.common_practice_region}: ` +
        (adoptionPct != null ? `${adoptionPct}% adoption` : "adoption rate unknown") +
        (adoptionPct != null && adoptionPct < 20
          ? " (below the 20% threshold, passes on its own)"
          : a.step4c_demonstrated
            ? " (Step 4c demonstrated)"
            : " (Step 4c not yet demonstrated)") +
        ` — assessed ${new Date(a.assessed_at).toLocaleDateString("en-GB")}.`,
    );
  } else {
    lines.push("- No additionality assessment recorded yet — run record_additionality_assessment first.");
  }

  const content = lines.join("\n");

  const inserted = await query<{ draft_id: string }>(
    `INSERT INTO mrv.pdd_drafts (project_id, template_id, content, sections_total, sections_filled, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING draft_id`,
    [input.projectId, template.template_id, content, template.structure.length, sectionsFilled, ctx.actor],
  );
  const draftId = inserted[0].draft_id;

  await audit(ctx, "generate_pdd_draft", { type: "pdd_draft", id: draftId }, {
    projectId: input.projectId,
    templateName: template.name,
    templateVersion: template.version,
    sectionsTotal: template.structure.length,
    sectionsFilled,
  });

  return ok({
    draftId,
    projectId: input.projectId,
    templateName: template.name,
    templateVersion: template.version,
    sectionsTotal: template.structure.length,
    sectionsFilled,
    content,
  });
}
