-- migrate:up
-- =====================================================================
-- 0079 — mrv.pdd_section_draft_history: step 2 of the agent-learning
-- plan (see 0078's own comment for the full context).
--
-- draftPddChapterContent.ts overwrites drafted_text in place on every
-- redraft (confirmed by reading it: `UPDATE mrv.pdd_section_status SET
-- drafted_text = $1 ... WHERE status_id = $3`, no prior version kept).
-- That means there was no way to later ask "did the human keep this
-- draft as-is, or did the next redraft look nothing like what got
-- approved" — the one real blind spot in an otherwise-real feedback
-- loop (0078's agent_feedback). This captures the version being
-- replaced, not the new one — the new one is already in
-- pdd_section_status.drafted_text itself.
-- =====================================================================

CREATE TABLE mrv.pdd_section_draft_history (
  history_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id    uuid NOT NULL REFERENCES mrv.pdd_section_status(status_id) ON DELETE CASCADE,
  drafted_text text NOT NULL,
  replaced_by  text NOT NULL,
  replaced_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdd_section_draft_history_status ON mrv.pdd_section_draft_history (status_id, replaced_at DESC);

COMMENT ON TABLE mrv.pdd_section_draft_history IS
  'The drafted_text a redraft is about to overwrite, captured before the UPDATE — draftPddChapterContent.ts''s own history, so a later redraft can be compared against what was there (and whether it was ever approved) before it.';

-- migrate:down
DROP TABLE IF EXISTS mrv.pdd_section_draft_history;
