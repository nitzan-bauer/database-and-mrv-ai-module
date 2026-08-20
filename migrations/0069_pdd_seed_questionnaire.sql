-- migrate:up
-- =====================================================================
-- 0069 — PDD SEED Questionnaire, rebuilt from scratch per Nitzan's own
-- re-spec (live this session, "PDD SEED QUESTIONNAIRE.docx"): a small,
-- fixed package of base questions, asked once per new PDD, deliberately
-- NOT aligned to the VCS template's own 96 sections — that's what
-- mrv.pdd_section_status (0053) already is, and it stays exactly as-is
-- to power PDD Development (0067). This is a different, smaller thing:
-- an intake form, not a per-section tracker.
--
-- question_key is a fixed catalog defined in code
-- (src/lib/pdd/seedQuestions.ts), not data — the table only holds
-- answers, the same way mrv.pdd_section_status holds template answers
-- but not the template itself.
-- =====================================================================

CREATE TABLE mrv.pdd_seed_answers (
  answer_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES mrv.projects(project_id) ON DELETE CASCADE,
  question_key text NOT NULL,
  answer_text text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, question_key)
);

CREATE INDEX idx_pdd_seed_answers_project ON mrv.pdd_seed_answers (project_id);

COMMENT ON TABLE mrv.pdd_seed_answers IS
  'The flat, fixed SEED questionnaire — one row per (project, question_key). Not tied to any PDD template''s own section structure.';

-- "Prepared by" (real, red-marked constant, both SEED spec docs): org
-- profile already carries the legal entity + primary contact; the one
-- fact missing is the co-author, so that's all this adds.
ALTER TABLE mrv.org_profile
  ADD COLUMN IF NOT EXISTS prepared_by_authors text;

COMMENT ON COLUMN mrv.org_profile.prepared_by_authors IS
  'Additional named co-author(s) for the PDD "Prepared by" line, beyond the primary contact — e.g. "Elad Bouton".';

UPDATE mrv.org_profile SET prepared_by_authors = 'Elad Bouton';

-- migrate:down
ALTER TABLE mrv.org_profile DROP COLUMN IF EXISTS prepared_by_authors;
DROP TABLE IF EXISTS mrv.pdd_seed_answers;
