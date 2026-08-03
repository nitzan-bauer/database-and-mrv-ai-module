-- migrate:up
-- =====================================================================
-- 0042 — Dave's and Rebeka's vvb_liaison / vvb_validation_liaison skill:
-- record_vvb_finding + resolve_vvb_finding.
--
-- Grounded in Verra's own real terminology, not invented structure: the
-- VCS Joint Validation & Verification Report Template requires a VVB to
-- state, for every finding raised, its type — Corrective Action Request
-- (CAR), Clarification Request (CR), or Forward Action Request (FAR),
-- or another kind — the issue raised, the proponent's response, and the
-- final conclusion. That is exactly what mrv.vvb_findings records; the
-- five eligibility-criteria types in 0035 and this migration's three
-- finding types both come from Verra's own published templates, not a
-- checklist made up for this build.
--
-- Neither actual VVB communication (there is still no mail integration)
-- nor the VVB's own judgement is simulated here — this is a tracker a
-- person keeps current from real correspondence, the same standing as
-- public_comment.
--
-- Mutable, not append-only: a finding moves from open to resolved as
-- real work on it progresses, the same standing mrv.mvr already has.
-- Both actions are 'auto' — working rows, commit nothing externally.
-- =====================================================================

CREATE TYPE mrv.vvb_finding_type AS ENUM ('CAR', 'CR', 'FAR', 'other');
CREATE TYPE mrv.vvb_finding_stage AS ENUM ('validation', 'verification');
CREATE TYPE mrv.vvb_finding_status AS ENUM ('open', 'resolved');

CREATE TABLE mrv.vvb_findings (
  finding_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  stage         mrv.vvb_finding_stage NOT NULL,
  finding_type  mrv.vvb_finding_type NOT NULL,
  issue_raised  text NOT NULL,
  raised_by     text,
  raised_at     date,
  response      text,
  conclusion    text,
  status        mrv.vvb_finding_status NOT NULL DEFAULT 'open',
  recorded_by   text NOT NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vvb_findings_project ON mrv.vvb_findings (project_id, status);

COMMENT ON TABLE mrv.vvb_findings IS
  'VVB validation/verification findings — CAR/CR/FAR/other, per the VCS Joint Validation & Verification Report Template. A tracker kept current from real correspondence, not a simulation of the VVB itself.';

CREATE TRIGGER trg_vvb_findings_upd BEFORE UPDATE ON mrv.vvb_findings FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_audit_vvb_findings AFTER INSERT OR UPDATE ON mrv.vvb_findings FOR EACH ROW EXECUTE FUNCTION mrv.log_change('finding_id');

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('record_vvb_finding',  'auto', 'Writes a working row, not append-only; commits nothing externally.'),
  ('resolve_vvb_finding', 'auto', 'Updates a working row, not append-only; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_vvb_finding', 'resolve_vvb_finding']::text[],
       skills = skills || ARRAY['vvb_liaison']::text[],
       planned_skills = array_remove(planned_skills, 'vvb_liaison')
 WHERE agent_id = 'dave'
   AND NOT ('record_vvb_finding' = ANY (tools));

UPDATE mrv.agents
   SET tools = tools || ARRAY['record_vvb_finding', 'resolve_vvb_finding']::text[],
       skills = skills || ARRAY['vvb_validation_liaison']::text[],
       planned_skills = array_remove(planned_skills, 'vvb_validation_liaison')
 WHERE agent_id = 'rebeka'
   AND NOT ('record_vvb_finding' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'record_vvb_finding'), 'resolve_vvb_finding'),
       skills = array_remove(skills, 'vvb_validation_liaison'),
       planned_skills = planned_skills || ARRAY['vvb_validation_liaison']::text[]
 WHERE agent_id = 'rebeka';

UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'record_vvb_finding'), 'resolve_vvb_finding'),
       skills = array_remove(skills, 'vvb_liaison'),
       planned_skills = planned_skills || ARRAY['vvb_liaison']::text[]
 WHERE agent_id = 'dave';

DELETE FROM mrv.agent_action_policies WHERE action_name IN ('record_vvb_finding', 'resolve_vvb_finding');

DROP TRIGGER IF EXISTS trg_audit_vvb_findings ON mrv.vvb_findings;
DROP TRIGGER IF EXISTS trg_vvb_findings_upd ON mrv.vvb_findings;
DROP TABLE IF EXISTS mrv.vvb_findings;
DROP TYPE IF EXISTS mrv.vvb_finding_status;
DROP TYPE IF EXISTS mrv.vvb_finding_stage;
DROP TYPE IF EXISTS mrv.vvb_finding_type;
