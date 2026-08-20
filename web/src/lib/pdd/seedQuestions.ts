/**
 * The SEED questionnaire's own fixed question catalog — Nitzan's own
 * re-spec (live this session, "PDD SEED QUESTIONNAIRE.docx"), rebuilt
 * from scratch to replace the old questionnaire that reused the VCS
 * template's 96 sections. These questions are deliberately NOT aligned
 * to any PDD template section; the catalog itself is code, not data,
 * the same way mrv.pdd_templates.structure is the source of truth for
 * the *other* per-section tracker (mrv.pdd_section_status) while this
 * file is the source of truth here.
 *
 * 8 base questions + 3 questions Rebeka proposed the day before + 5
 * questions added 2026-08-19 = 16, matching Nitzan's own count. The "3
 * from yesterday" were recovered from his own screenshots of that
 * round ("3 השאלות שרבקה הציעה" — short, technical, no expertise
 * required): Project Details, Project Start Date and Initial Crediting
 * Period Start Date, Description of the Project Activity. Methodology
 * name and geographic area (also floated as candidates) are NOT asked
 * here — Nitzan's own instruction was "Rebeka can learn this herself",
 * so they're auto-filled facts (seedAnswers.ts) instead.
 */
export interface SeedQuestionDef {
  key: string;
  label: string;
  /** Shown under the label, guiding what a good answer looks like. */
  hint?: string;
  /** Pre-filled starting value for a question with a real, usual answer — still editable. */
  defaultValue?: string;
  /** This question is answered via a different, dedicated surface (e.g. the GHG table) rather than a plain text box. */
  external?: { note: string; href?: string };
}

export const SEED_QUESTIONS: SeedQuestionDef[] = [
  { key: "project_name", label: "Project name" },
  {
    key: "project_details",
    label: "Project Details",
    hint: "Official project name, physical location (address), and who owns/operates it.",
  },
  {
    key: "start_and_crediting_dates",
    label: "Project Start Date and Initial Crediting Period Start Date",
    hint: "Two dates only: when the activity actually started, and when the crediting period should start counting.",
  },
  {
    key: "project_activity_description",
    label: "Description of the Project Activity",
    hint: "A few simple sentences about what the project actually does, where, and its overall purpose — as if explaining to a friend who's never heard of it.",
  },
  {
    key: "related_projects",
    label: "Related Project(s)",
    hint: "Real, comparable Verra projects — Project ID, proponent, title. Rebeka researches more like these once you give her a starting point.",
  },
  { key: "starting_date", label: "Project Starting date" },
  {
    key: "crediting_period",
    label: "Crediting period",
    defaultValue: "20 years, renewable for further 20-year terms, within a 100-year program period.",
  },
  { key: "project_activities", label: "Project activities" },
  { key: "baseline_scenario", label: "Baseline scenario" },
  {
    key: "ghg_estimates",
    label: "Estimated GHG Emission Reductions and Carbon Dioxide Removals",
    external: {
      note: "Filled in the real GHG reductions table (vintage year + net reduction), not free text — see PDD Development, section 4.5.1, once drafted.",
    },
  },
  {
    key: "stakeholder_identification",
    label: "Stakeholder Engagement and Consultation",
    hint: "How did you identify the stakeholders affected by this project (neighbouring communities, farm workers)? One sentence is enough.",
  },
  {
    key: "known_risks",
    label: "Risks to Stakeholders and the Environment",
    hint: 'Any known environmental or social risk right now (e.g. water-use conflict, land dispute)? If none, say "none identified".',
  },
  {
    key: "grievance_process",
    label: "Respect for Human Rights and Equity",
    hint: "Does CarboNature have (or plan) a grievance process for farmers to raise concerns? Yes/No, one line.",
  },
  {
    key: "soc_measurement_technique",
    label: "SOC measurement technique",
    hint: "Which SOC measurement technique do you actually use (e.g. dry combustion, LOI)? One line.",
  },
  {
    key: "ghg_target_sanity_check",
    label: "GHG target sanity-check",
    hint: "Do you have a target/expected total tCO2e for the full 20-year crediting period, to sanity-check the draft-estimate extrapolation?",
  },
];
