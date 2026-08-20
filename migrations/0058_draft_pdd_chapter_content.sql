-- migrate:up
-- =====================================================================
-- 0058 — Rebeka drafts actual section prose, grounded in precedent.
--
-- Until now the questionnaire was pure passthrough: whatever a person
-- typed into a section landed in the Google Doc verbatim. Nitzan's own
-- brief for the real PDD Generator round is explicit that this isn't
-- enough — his answers are meant to be "raw direction only", and Rebeka
-- is supposed to write the actual VM0042-precedent-style prose from
-- them (research_pdd_precedents' indexed corpus + the real project
-- facts already in mrv).
--
-- input_text keeps meaning exactly what it always has: text a person
-- typed in directly, taken as final. drafted_text is new and separate —
-- the model's output, grounded in input_text as direction but never
-- silently overwriting it, and never confused with something a person
-- actually wrote. 'drafted' is a new status distinct from 'answered':
-- answered means a person is standing behind this text; drafted means
-- Rebeka is, and it has not been reviewed yet.
-- =====================================================================

ALTER TABLE mrv.pdd_section_status ADD COLUMN drafted_text text;
COMMENT ON COLUMN mrv.pdd_section_status.drafted_text IS
  'Model-drafted section prose, grounded in input_text + project facts + precedent excerpts. Never a substitute for review — status=drafted means unreviewed.';

ALTER TABLE mrv.pdd_section_status DROP CONSTRAINT pdd_section_status_status_check;
ALTER TABLE mrv.pdd_section_status ADD CONSTRAINT pdd_section_status_status_check
  CHECK (status IN ('pending', 'answered', 'skipped', 'drafted'));

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('draft_pdd_chapter_content', 'auto',
        'Model-drafted section prose written to drafted_text, status=drafted — never auto-promoted to answered. No external effect.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = array_append(tools, 'draft_pdd_chapter_content')
 WHERE agent_id = 'rebeka' AND NOT ('draft_pdd_chapter_content' = ANY (tools));

-- migrate:down
UPDATE mrv.agents
   SET tools = array_remove(tools, 'draft_pdd_chapter_content')
 WHERE agent_id = 'rebeka';
DELETE FROM mrv.agent_action_policies WHERE action_name = 'draft_pdd_chapter_content';

ALTER TABLE mrv.pdd_section_status DROP CONSTRAINT pdd_section_status_status_check;
ALTER TABLE mrv.pdd_section_status ADD CONSTRAINT pdd_section_status_status_check
  CHECK (status IN ('pending', 'answered', 'skipped'));
ALTER TABLE mrv.pdd_section_status DROP COLUMN IF EXISTS drafted_text;
