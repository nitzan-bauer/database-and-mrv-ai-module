-- migrate:up
-- =====================================================================
-- 0053 — the structured PDD questionnaire: one row per template
-- section, not a chat.
--
-- Nitzan's own words on why: the intake process runs over several
-- weeks with a SKIP option per question, and a conversational "Ask
-- Rebeka" turn (one message, one reply, gone) is the wrong shape for
-- something a person returns to on their own schedule. A row per
-- section that holds pending/answered/skipped plus whatever text was
-- entered is exactly the shape "I'll come back to this later" needs —
-- and it is also the data source for the PDD Readiness Report's
-- per-chapter % and missing-inputs table, so it earns its keep twice.
--
-- Keyed by (project_id, template_id, section_index) rather than by
-- section_title: two sections can share a heading text at different
-- levels/positions, and index is the template's own ordering, stable
-- for a given registered template version. title/level are stored
-- alongside as a snapshot for display without re-parsing the
-- template's JSON structure on every read.
-- =====================================================================

CREATE TABLE mrv.pdd_section_status (
  status_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  template_id    uuid NOT NULL REFERENCES mrv.pdd_templates(template_id) ON DELETE CASCADE,
  section_index  integer NOT NULL,
  section_title  text NOT NULL,
  section_level  integer NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'skipped')),
  input_text     text,
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, template_id, section_index)
);

CREATE INDEX idx_pdd_section_status_project ON mrv.pdd_section_status (project_id, template_id);

COMMENT ON TABLE mrv.pdd_section_status IS
  'The structured PDD intake questionnaire — one row per template section, filled in over multiple sessions with an explicit skip state. Also the data source for the PDD Readiness Report''s per-chapter completeness.';

CREATE TRIGGER trg_pdd_section_status_upd BEFORE UPDATE ON mrv.pdd_section_status
  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('update_pdd_section_status', 'auto', 'Writes one section''s answered/skipped state and input text — a working record, not an external action.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['update_pdd_section_status']::text[]
 WHERE agent_id = 'rebeka'
   AND NOT ('update_pdd_section_status' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'update_pdd_section_status')
 WHERE agent_id = 'rebeka';

DELETE FROM mrv.agent_action_policies WHERE action_name = 'update_pdd_section_status';

DROP TRIGGER IF EXISTS trg_pdd_section_status_upd ON mrv.pdd_section_status;
DROP TABLE IF EXISTS mrv.pdd_section_status;
