import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";
import { fetchSaasFarm } from "../saas/saasClient";

export interface ImportedFarm {
  farmId: string;
  name: string;
  created: boolean;
}

export interface ImportedSaasProject {
  projectId: string;
  projectCreated: boolean;
  farms: ImportedFarm[];
}

function shortCode(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return (letters || "FRM").slice(0, 4);
}

/**
 * Bring a real, already-onboarded project and its farms from the
 * customer-facing SaaS database into mrv — the first step any real PDD
 * needs, and one nothing before this tool could do: every farm the app
 * has worked with until now was demo data (is_demo=true throughout).
 *
 * Deliberately explicit rather than inferring a project id by walking
 * SaaS plots→project links: this writes a real, is_demo=false project
 * that Rebeka will build a real submission to Verra from, and a wrong
 * guess here is exactly the kind of silent misclassification 0007's
 * is_demo trigger exists to prevent.
 *
 * Does not import plots. mrv.plots.quantification_approach is NOT NULL
 * with no neutral default (QA1 model-based vs QA2 baseline-control-site-
 * based materially changes how a plot gets accounted), and that choice
 * has not been made yet for these farms — importing plots with a guessed
 * approach would be worse than not importing them. A farm with 0 plots
 * shows up as exactly that everywhere downstream (map, compliance,
 * questionnaire), which is the honest state until the QA decision lands.
 */
export async function importSaasProjectFarms(
  ctx: ToolContext,
  input: {
    projectId: string;
    projectName: string;
    country: string;
    methodology?: string;
    creditingStart?: string;
    creditingEnd?: string;
    saasFarmIds: string[];
  },
): Promise<ToolResult<ImportedSaasProject>> {
  const guard = requireDbMode("importSaasProjectFarms");
  if (guard) return guard;

  const policy = await checkPolicy("import_saas_project_farms", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!input.projectId?.trim()) return fail("importSaasProjectFarms: projectId is required.");
  if (!input.projectName?.trim()) return fail("importSaasProjectFarms: projectName is required.");
  if (!input.saasFarmIds?.length) return fail("importSaasProjectFarms: at least one saasFarmIds entry is required.");

  const { query } = await import("../db");

  const orgs = await query<{ org_id: string }>(`SELECT org_id FROM mrv.organizations LIMIT 1`);
  if (!orgs.length) return fail("importSaasProjectFarms: no organization exists to attach this project to.");
  const orgId = orgs[0].org_id;

  const existingProject = await query<{ project_id: string }>(
    `SELECT project_id FROM mrv.projects WHERE project_id = $1`,
    [input.projectId.trim()],
  );
  const projectCreated = existingProject.length === 0;

  if (projectCreated) {
    await query(
      `INSERT INTO mrv.projects (project_id, org_id, name, methodology, is_grouped, country, status, is_demo, crediting_start, crediting_end)
       VALUES ($1, $2, $3, $4, true, $5, 'under_development', false, $6, $7)`,
      [
        input.projectId.trim(),
        orgId,
        input.projectName.trim(),
        input.methodology?.trim() || "VM0042 v2.2",
        input.country.trim(),
        input.creditingStart ?? null,
        input.creditingEnd ?? null,
      ],
    );
  }

  const farms: ImportedFarm[] = [];
  for (const saasFarmId of input.saasFarmIds) {
    const saasFarm = await fetchSaasFarm(saasFarmId);
    if (!saasFarm) {
      return fail(`importSaasProjectFarms: SaaS farm ${saasFarmId} was not found — nothing imported for it.`);
    }

    const existingFarm = await query<{ farm_id: string }>(
      `SELECT farm_id FROM mrv.farms WHERE saas_farm_id = $1`,
      [saasFarmId],
    );
    const operator = [saasFarm.contact_first, saasFarm.contact_surname]
      .filter(Boolean)
      .map((s) => s!.trim())
      .join(" ") || null;

    if (existingFarm.length) {
      await query(
        `UPDATE mrv.farms SET name = $2, operator = $3, country = $4, region = $5 WHERE saas_farm_id = $1`,
        [saasFarmId, saasFarm.farm_name, operator, saasFarm.addr_country, saasFarm.addr_city],
      );
      farms.push({ farmId: existingFarm[0].farm_id, name: saasFarm.farm_name, created: false });
    } else {
      await query(
        `INSERT INTO mrv.farms
           (farm_id, project_id, name, installation_code, operator, country, region, status, is_demo, saas_farm_id, project_start_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', false, $1, $8)`,
        [
          saasFarmId,
          input.projectId.trim(),
          saasFarm.farm_name,
          shortCode(saasFarm.farm_name),
          operator,
          saasFarm.addr_country,
          saasFarm.addr_city,
          input.creditingStart ?? null,
        ],
      );
      farms.push({ farmId: saasFarmId, name: saasFarm.farm_name, created: true });
    }
  }

  await audit(ctx, "import_saas_project_farms", { type: "project", id: input.projectId.trim() }, {
    projectCreated,
    farms: farms.map((f) => ({ farmId: f.farmId, name: f.name, created: f.created })),
  });

  return ok({ projectId: input.projectId.trim(), projectCreated, farms });
}
