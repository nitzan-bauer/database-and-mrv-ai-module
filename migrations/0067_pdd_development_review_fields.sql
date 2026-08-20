-- migrate:up
-- =====================================================================
-- 0067 — PDD Development interface (Nitzan's own spec, live this
-- session): a second, separate view of mrv.pdd_section_status, for
-- iterating a section from Rebeka's first draft up to 100% readiness.
-- Each section shows 4 panes: Rebeka's answer (drafted_text, existing),
-- missing inputs (extracted from drafted_text, existing, no new column),
-- Nitzan's comments/tasks to Rebeka on the drafted answer (NEW —
-- review_comment), and Nitzan's own answers to the missing inputs
-- (existing — input_text, reused, feeds the next drafting pass).
--
-- review_comment is human-only, same standing as input_text and for the
-- same reason (0053's own incident: an agent wrote invented data into
-- input_text under the actor's name) — a "task for Rebeka" carries the
-- same weight as a confirmed answer and must not be put in her mouth by
-- her own drafting pass.
--
-- dev_approved is a second, independent axis from `status` — `status`
-- (pending/answered/skipped/drafted) is the SEED questionnaire's own
-- state; approving a drafted section in this development pass is a
-- different decision a person makes only after reading real prose, not
-- something the intake flow's status enum was ever meant to carry.
-- =====================================================================

ALTER TABLE mrv.pdd_section_status
  ADD COLUMN IF NOT EXISTS review_comment text,
  ADD COLUMN IF NOT EXISTS dev_approved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mrv.pdd_section_status.review_comment IS
  'Nitzan''s own comments/tasks to Rebeka about the drafted answer for this section — human-only, same guard as input_text.';
COMMENT ON COLUMN mrv.pdd_section_status.dev_approved IS
  'Nitzan approved this section''s drafted answer (or table) in the PDD Development interface — independent of the SEED questionnaire''s own status.';

-- migrate:down
ALTER TABLE mrv.pdd_section_status
  DROP COLUMN IF EXISTS review_comment,
  DROP COLUMN IF EXISTS dev_approved;
