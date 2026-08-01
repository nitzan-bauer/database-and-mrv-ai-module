-- migrate:up
-- =====================================================================
-- 0027 — versioned PDD templates, and Rebeka's first tool.
--
-- Verra's project-description template is not fixed. It differs by
-- methodology and changes over time — this build alone received v5.0A of
-- the general VCS template, and a VM0042 project may layer methodology-
-- specific requirements on top. Building "the PDD" as a set of section
-- names in application code would need a code change every time Verra
-- revises the template, and would silently mismatch the moment a project
-- uses a different version than whichever one happened to get hardcoded.
--
-- So the template is data. mrv.pdd_templates stores the source file's
-- integrity hash alongside its parsed section outline (headings, nesting,
-- and the instructional/guidance text under each), and a PDD-writing skill
-- reads the current template rather than assuming one. Two templates can
-- coexist — a project already under validation keeps the version it
-- started on, even after a newer one is registered.
--
-- Append-only, like mrv.ghg_parameters: a template version, once used to
-- prepare a submission, must not change under an in-flight validation. A
-- new version is a new row; nothing here is ever edited or replaced.
-- =====================================================================

CREATE TABLE mrv.pdd_templates (
  template_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,             -- 'VCS Project Description Template'
  version        text NOT NULL,             -- 'v5.0A'
  source_path    text NOT NULL,             -- path checked into the repo, docs/source/...
  source_sha256  text NOT NULL,             -- integrity of the exact file parsed
  section_count  integer NOT NULL CHECK (section_count > 0),
  structure      jsonb NOT NULL,            -- ordered [{level,title,body}] outline
  registered_by  text NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (name, version)
);

CREATE INDEX idx_pdd_templates_name ON mrv.pdd_templates (name, registered_at DESC);

COMMENT ON TABLE mrv.pdd_templates IS
  'Verra project-description templates, versioned. The template changes per methodology and over time, so its structure is stored as data rather than assumed by a PDD-writing skill.';
COMMENT ON COLUMN mrv.pdd_templates.structure IS
  'Ordered section outline: [{level, title, body}]. body is the instructional/guidance text under that heading in the source document, which the template author expects deleted from a final submission and which a PDD-writing skill uses to know what each section must contain.';

CREATE TRIGGER trg_noupd_pdd_templates
  BEFORE UPDATE OR DELETE ON mrv.pdd_templates
  FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

CREATE TRIGGER trg_audit_pdd_templates AFTER INSERT ON mrv.pdd_templates
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('template_id');

-- ---- Rebeka's first tool ----------------------------------------------
-- Registering a reference document commits nothing externally and is
-- reviewable the moment it lands — the same standing as
-- propose_sampling_plan, which is 'auto' despite writing rows of its own.
-- What later gets drafted FROM this template, and any actual submission to
-- Verra, are separate actions this policy says nothing about.
INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('register_pdd_template', 'auto', 'Stores a reference document; commits nothing externally.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = array_append(tools, 'register_pdd_template')
 WHERE agent_id = 'rebeka' AND NOT ('register_pdd_template' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'register_pdd_template')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'register_pdd_template';
DROP TRIGGER IF EXISTS trg_audit_pdd_templates ON mrv.pdd_templates;
DROP TRIGGER IF EXISTS trg_noupd_pdd_templates ON mrv.pdd_templates;
DROP TABLE IF EXISTS mrv.pdd_templates;
