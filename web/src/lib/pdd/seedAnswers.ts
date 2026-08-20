import "server-only";
import { SEED_QUESTIONS } from "./seedQuestions";

export interface SeedAnswerRow {
  questionKey: string;
  label: string;
  hint: string | null;
  answerText: string | null;
  status: "pending" | "answered";
  externalNote: string | null;
}

export interface SeedAutoFact {
  label: string;
  value: string;
}

export interface SeedQuestionnaireState {
  projectName: string | null;
  rows: SeedAnswerRow[];
  autoFacts: SeedAutoFact[];
  pendingCount: number;
}

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/**
 * The SEED questionnaire's current state for a project — the fixed
 * question catalog (code, not data) joined against whatever's actually
 * been answered so far, seeding any question that's never been touched
 * as 'pending' on first read (same pattern as
 * listPddSectionStatus, applied to a much smaller, unrelated table).
 */
export async function listSeedAnswers(query: Query, projectId: string): Promise<SeedQuestionnaireState> {
  const existing = await query<{ question_key: string; answer_text: string | null; status: "pending" | "answered" }>(
    `SELECT question_key, answer_text, status FROM mrv.pdd_seed_answers WHERE project_id = $1`,
    [projectId],
  );
  const byKey = new Map(existing.map((r) => [r.question_key, r]));

  // "ghg_estimates" has no text box (it's answered via the real GHG
  // table, mrv.ghg_reduction_estimates) — read whether real rows exist
  // there directly, rather than leaving it permanently 'pending' with no
  // UI path to ever mark it otherwise.
  const ghgRows = await query<{ n: string }>(
    `SELECT count(*)::text n FROM mrv.ghg_reduction_estimates WHERE project_id = $1`,
    [projectId],
  );
  const ghgRowCount = Number(ghgRows[0]?.n ?? 0);

  const rows: SeedAnswerRow[] = SEED_QUESTIONS.map((q) => {
    const found = byKey.get(q.key);
    if (q.key === "ghg_estimates") {
      return {
        questionKey: q.key,
        label: q.label,
        hint: q.hint ?? null,
        answerText: ghgRowCount ? `${ghgRowCount} vintage year${ghgRowCount === 1 ? "" : "s"} on file` : null,
        status: ghgRowCount ? "answered" : "pending",
        externalNote: q.external?.note ?? null,
      };
    }
    return {
      questionKey: q.key,
      label: q.label,
      hint: q.hint ?? null,
      answerText: found?.answer_text ?? q.defaultValue ?? null,
      status: found?.status ?? (q.defaultValue ? "answered" : "pending"),
      externalNote: q.external?.note ?? null,
    };
  });

  const projectNameRow = byKey.get("project_name");
  const autoFacts = await computeAutoFilledFacts(query, projectId);

  return {
    projectName: projectNameRow?.answer_text?.trim() || null,
    rows,
    autoFacts,
    pendingCount: rows.filter((r) => r.status === "pending").length,
  };
}

/**
 * The "red-marked" constants from both SEED spec docs — Rebeka already
 * has these, so they're shown as confirmed facts, never asked. Company/
 * Proponent details and Prepared-by come from mrv.org_profile (0060);
 * participating farms and their real operator names come straight from
 * mrv.farms, the same source draftPddChapterContent already trusts;
 * methodology name and geographic area are read off the project/farms
 * rows themselves — Nitzan's own instruction: "Rebeka can learn this
 * herself", not something to type in every time.
 */
export async function computeAutoFilledFacts(query: Query, projectId: string): Promise<SeedAutoFact[]> {
  const facts: SeedAutoFact[] = [];

  const projects = await query<{ name: string; methodology: string; country: string }>(
    `SELECT name, methodology, country FROM mrv.projects WHERE project_id = $1`,
    [projectId],
  );
  const project = projects[0];

  const orgProfiles = await query<{
    legal_name: string;
    address: string;
    contact_name: string;
    contact_title: string;
    contact_email: string;
    prepared_by_authors: string | null;
  }>(`SELECT legal_name, address, contact_name, contact_title, contact_email, prepared_by_authors FROM mrv.org_profile LIMIT 1`);
  const org = orgProfiles[0];

  if (org) {
    facts.push({
      label: "Prepared by",
      value: `${org.legal_name}, authored Mr. ${org.contact_name}${org.prepared_by_authors ? ` and Mr. ${org.prepared_by_authors}` : ""}`,
    });
    facts.push({
      label: "Project Proponent",
      value: `${org.legal_name} — ${org.contact_name}, ${org.contact_title} — ${org.contact_email}, ${org.address}`,
    });
  }

  const farms = await query<{ name: string; operator: string | null; country: string | null; region: string | null }>(
    `SELECT name, operator, country, region FROM mrv.farms WHERE project_id = $1 AND NOT is_demo ORDER BY name`,
    [projectId],
  );
  if (farms.length) {
    facts.push({
      label: "Participating farms and farmers",
      value: farms.map((f) => `${f.name} (${f.operator ?? "operator unknown"}, ${[f.region, f.country].filter(Boolean).join(", ")})`).join("; "),
    });
    const regions = [...new Set(farms.map((f) => [f.region, f.country].filter(Boolean).join(", ")))];
    facts.push({ label: "Geographic area", value: regions.join(" · ") || project?.country || "unknown" });
  } else if (project?.country) {
    facts.push({ label: "Geographic area", value: project.country });
  }

  if (project?.methodology) {
    facts.push({ label: "Methodology", value: project.methodology });
  }

  return facts;
}
