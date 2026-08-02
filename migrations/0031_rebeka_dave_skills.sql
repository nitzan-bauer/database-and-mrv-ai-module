-- migrate:up
-- =====================================================================
-- 0031 — the skills that can be built honestly right now, for both
-- Rebeka and Dave, following the same rule the whole build has followed
-- since T2-1: a "skill" is a thin, declared tool surface over an
-- already-real, already-verified engine — never a model call, and never
-- a fabricated computation standing in for a real one.
--
-- Three of Rebeka's planned_skills move to skills here because their
-- engine now exists:
--   - kmz_preparation:  export_plots_kmz, a real zip writer over the
--     KML export mrv already produces (exportPlotsKml.ts).
--   - additionality:    record_additionality_assessment, structured
--     around the actual three steps VM0042 v2.2 §7 requires
--     (regulatory surplus, barrier analysis, <20% common practice) —
--     sourced from docs/source/VM0042v2.2.txt, not invented.
--   - pdd_generator:    generate_pdd_draft, which assembles a real draft
--     from the registered template's own section outline and real
--     project/farm/compliance data, marking narrative-only sections as
--     needing a person rather than fabricating their content.
--
-- Two of Dave's planned_skills move likewise, because they wrap tools
-- that already exist and are already verified:
--   - stratification:     wraps createSamplingPlan's real PostGIS work.
--   - baseline_definition: wraps recordBaselineSite (migration 0030).
--   - soc_datasheet:       wraps ingestLabResults's real datasheet parse.
--
-- dndc and daycent stay in planned_skills. Nothing here integrates an
-- actual DNDC/DayCent simulation — that would need the external model
-- itself, which this repo has never had access to — so building either
-- "skill" today would mean faking a scientific result. Refused, same as
-- everywhere else in this build.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_additionality_assessment', 'auto', 'Writes a working assessment row; commits nothing to Verra by itself.'),
  ('export_plots_kmz', 'confirm', 'Produces a file for external use (Google Earth, a VVB); a person should see it go out.'),
  ('generate_pdd_draft', 'confirm', 'Produces a draft document; a person should review before it is treated as real PDD content.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_additionality_assessment', 'export_plots_kmz', 'generate_pdd_draft']::text[],
       skills = skills || ARRAY['kmz_preparation', 'additionality', 'pdd_generator']::text[],
       planned_skills = array_remove(array_remove(array_remove(planned_skills,
         'kmz_preparation'), 'additionality'), 'pdd_generator')
 WHERE agent_id = 'rebeka'
   AND NOT ('record_additionality_assessment' = ANY (tools));

UPDATE mrv.agents
   SET skills = skills || ARRAY['stratification', 'baseline_definition', 'soc_datasheet']::text[],
       planned_skills = array_remove(array_remove(array_remove(planned_skills,
         'stratification'), 'baseline_definition'), 'soc_datasheet')
 WHERE agent_id = 'dave'
   AND NOT ('stratification' = ANY (skills));

CREATE TABLE mrv.additionality_assessments (
  assessment_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                text NOT NULL REFERENCES mrv.projects (project_id),

  -- Step 1 (VM0042 §7): regulatory surplus.
  regulatory_surplus_met    boolean NOT NULL,
  regulatory_surplus_note   text NOT NULL,

  -- Step 2 (VM0042 §7, VT0008): institutional barrier analysis. Free-form
  -- because VT0008's own barrier categories are not a document this repo
  -- has the source text for — recording whichever barriers were actually
  -- identified, same discipline as the baseline-site similarity criteria.
  barriers                  jsonb NOT NULL DEFAULT '[]',

  -- Step 3 (VM0042 §7): common practice test. The 20% threshold is the
  -- one number the methodology text itself states plainly.
  common_practice_region    text NOT NULL,
  common_practice_adoption_pct numeric(5,2) CHECK (common_practice_adoption_pct IS NULL
    OR (common_practice_adoption_pct >= 0 AND common_practice_adoption_pct <= 100)),
  step4c_demonstrated       boolean NOT NULL DEFAULT false,
  step4c_note               text,

  assessed_by               text NOT NULL,
  assessed_at               timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_additionality_project ON mrv.additionality_assessments (project_id, assessed_at DESC);

COMMENT ON TABLE mrv.additionality_assessments IS
  'VM0042 v2.2 §7 additionality: regulatory surplus, barrier analysis, and the <20% common-practice test (or Step 4c where adoption is at or above 20%, or unknown).';
COMMENT ON COLUMN mrv.additionality_assessments.common_practice_adoption_pct IS
  'Adoption rate in the project region. NULL means unknown/undetermined, which the tool treats the same as >=20% — Step 4c is then required, not assumed passed.';

CREATE TRIGGER trg_audit_additionality_assessments AFTER INSERT ON mrv.additionality_assessments
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('assessment_id');

CREATE TABLE mrv.pdd_drafts (
  draft_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text NOT NULL REFERENCES mrv.projects (project_id),
  template_id    uuid NOT NULL REFERENCES mrv.pdd_templates (template_id),
  content        text NOT NULL,
  sections_total integer NOT NULL,
  sections_filled integer NOT NULL,
  generated_by   text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdd_drafts_project ON mrv.pdd_drafts (project_id, generated_at DESC);

COMMENT ON TABLE mrv.pdd_drafts IS
  'Generated PDD drafts: every section heading from the registered template, filled with real project/farm/compliance data where that data exists, and explicitly marked as needing a person to write the rest. A working draft, not append-only — regenerating replaces nothing, it is a new row each time so the history of drafts stays visible.';

CREATE TRIGGER trg_audit_pdd_drafts AFTER INSERT ON mrv.pdd_drafts
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('draft_id');

-- migrate:down
DROP TRIGGER IF EXISTS trg_audit_pdd_drafts ON mrv.pdd_drafts;
DROP TABLE IF EXISTS mrv.pdd_drafts;

DROP TRIGGER IF EXISTS trg_audit_additionality_assessments ON mrv.additionality_assessments;
DROP TABLE IF EXISTS mrv.additionality_assessments;

UPDATE mrv.agents
   SET skills = array_remove(array_remove(array_remove(skills,
         'stratification'), 'baseline_definition'), 'soc_datasheet'),
       planned_skills = planned_skills || ARRAY['stratification', 'baseline_definition', 'soc_datasheet']::text[]
 WHERE agent_id = 'dave';

UPDATE mrv.agents
   SET tools = array_remove(array_remove(array_remove(tools,
         'record_additionality_assessment'), 'export_plots_kmz'), 'generate_pdd_draft'),
       skills = array_remove(array_remove(array_remove(skills,
         'kmz_preparation'), 'additionality'), 'pdd_generator'),
       planned_skills = planned_skills || ARRAY['kmz_preparation', 'additionality', 'pdd_generator']::text[]
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies
 WHERE action_name IN ('record_additionality_assessment', 'export_plots_kmz', 'generate_pdd_draft');
