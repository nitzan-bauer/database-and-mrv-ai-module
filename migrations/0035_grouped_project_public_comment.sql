-- migrate:up
-- =====================================================================
-- 0035 — Rebeka's fourth and fifth tools: grouped_project_design and
-- public_comment. Both are grounded in real, already-on-file source
-- text rather than invented structure:
--
--   grouped_project_design — VCS_Project_Description_Template_v5.0A's
--   own "Grouped Project Design" section: one row per eligibility area
--   (id shaped '[Project ID]_EA[N]', e.g. '9001_EA1', per the template's
--   own example), and one row per eligibility criteria type for that
--   area. The five criteria types are the template's own fixed list —
--   uniquely identifiable, baseline scenario, additionality, technology
--   or measure, methodology applicability conditions — not an invented
--   checklist. The tool refuses on a non-grouped project (mrv.projects
--   .is_grouped = false), exactly as the template's own instruction:
--   "This section only applies to grouped projects."
--
--   public_comment — the template's own "Public Comments" table: list
--   every comment received during (or after) the public comment period,
--   and how due account was taken of it. actionsTaken is required for
--   the same reason additionality's regulatorySurplusNote is required:
--   the template asks for the justification, not just that one exists.
--
-- Both are 'auto' — working rows, not append-only, the same standing as
-- record_additionality_assessment.
-- =====================================================================

CREATE TYPE mrv.eligibility_criteria_type AS ENUM (
  'uniquely_identifiable',
  'baseline_scenario',
  'additionality',
  'technology_or_measure',
  'methodology_applicability_conditions'
);

CREATE TABLE mrv.grouped_project_eligibility_areas (
  area_id      text PRIMARY KEY,                            -- '[Project ID]_EA[N]', e.g. '9001_EA1'
  project_id   text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  summary      text NOT NULL,                                -- boundary, activities/methodology, initial instances
  recorded_by  text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gp_areas_project ON mrv.grouped_project_eligibility_areas (project_id);

COMMENT ON TABLE mrv.grouped_project_eligibility_areas IS
  'VCS PDD Template v5.0A "Grouped Project Design": one eligibility area per row. Applies only to grouped projects (mrv.projects.is_grouped).';
COMMENT ON COLUMN mrv.grouped_project_eligibility_areas.area_id IS
  'Template''s own id shape: [Project ID]_EA[Eligibility Area ID], e.g. 9001_EA1.';

CREATE TABLE mrv.grouped_project_eligibility_criteria (
  criteria_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id        text NOT NULL REFERENCES mrv.grouped_project_eligibility_areas(area_id) ON DELETE CASCADE,
  criteria_type  mrv.eligibility_criteria_type NOT NULL,
  criteria_text  text NOT NULL,
  recorded_by    text NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, criteria_type)
);

COMMENT ON TABLE mrv.grouped_project_eligibility_criteria IS
  'One row per eligibility criteria type per area — the template''s own fixed five: uniquely identifiable, baseline scenario, additionality, technology or measure, methodology applicability conditions.';

CREATE TABLE mrv.public_comments (
  comment_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  comment_text             text NOT NULL,
  received_at              date NOT NULL,
  is_after_comment_period  boolean NOT NULL DEFAULT false,
  actions_taken            text NOT NULL,
  recorded_by              text NOT NULL,
  recorded_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_public_comments_project ON mrv.public_comments (project_id, received_at);

COMMENT ON TABLE mrv.public_comments IS
  'VCS PDD Template v5.0A "Public Comments": every comment received during (or after) the public comment period, and the actions taken or the justification for none.';
COMMENT ON COLUMN mrv.public_comments.actions_taken IS
  'Required — the template asks to "justify why updates were not necessary", not merely to log the comment.';

CREATE TRIGGER trg_audit_gp_areas    AFTER INSERT ON mrv.grouped_project_eligibility_areas    FOR EACH ROW EXECUTE FUNCTION mrv.log_change('area_id');
CREATE TRIGGER trg_audit_gp_criteria AFTER INSERT ON mrv.grouped_project_eligibility_criteria FOR EACH ROW EXECUTE FUNCTION mrv.log_change('criteria_id');
CREATE TRIGGER trg_audit_pubcomment  AFTER INSERT ON mrv.public_comments                      FOR EACH ROW EXECUTE FUNCTION mrv.log_change('comment_id');

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_grouped_project_design', 'auto', 'Writes a working row, not append-only; commits nothing externally.'),
  ('record_public_comment',         'auto', 'Writes a working row, not append-only; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_grouped_project_design', 'record_public_comment']::text[],
       skills = skills || ARRAY['grouped_project_design', 'public_comment']::text[],
       planned_skills = array_remove(array_remove(planned_skills,
         'grouped_project_design'), 'public_comment')
 WHERE agent_id = 'rebeka'
   AND NOT ('record_grouped_project_design' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools,
         'record_grouped_project_design'), 'record_public_comment'),
       skills = array_remove(array_remove(skills,
         'grouped_project_design'), 'public_comment'),
       planned_skills = planned_skills || ARRAY['grouped_project_design', 'public_comment']::text[]
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name IN ('record_grouped_project_design', 'record_public_comment');

DROP TRIGGER IF EXISTS trg_audit_pubcomment  ON mrv.public_comments;
DROP TRIGGER IF EXISTS trg_audit_gp_criteria ON mrv.grouped_project_eligibility_criteria;
DROP TRIGGER IF EXISTS trg_audit_gp_areas    ON mrv.grouped_project_eligibility_areas;

DROP TABLE IF EXISTS mrv.public_comments;
DROP TABLE IF EXISTS mrv.grouped_project_eligibility_criteria;
DROP TABLE IF EXISTS mrv.grouped_project_eligibility_areas;
DROP TYPE IF EXISTS mrv.eligibility_criteria_type;
