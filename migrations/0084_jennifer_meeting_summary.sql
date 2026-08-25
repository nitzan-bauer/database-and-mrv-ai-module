-- migrate:up
-- =====================================================================
-- 0084 — Jennifer's weekly meeting SUMMARY, on top of the cycle
-- infrastructure from 0083. The meeting is conducted in Hebrew, and
-- Google Meet's own "take notes"/transcript feature does not support
-- Hebrew (confirmed live 2026-08-25 against Google's own docs — only
-- English, French, German, Italian, Japanese, Korean, Portuguese,
-- Spanish), so this uses a Recall.ai bot to capture the audio instead,
-- then Groq Whisper (already proven Hebrew-capable this session) and
-- Claude for the actual Hebrew summary.
--
-- meet_link on the cycle: 0083's createCalendarEvent never requested a
-- Google Meet link, so the already-active cycle has none — this column
-- is filled in lazily on first need (see getOrCreateMeetLink in the
-- handler), not backfilled here, since backfilling would require a live
-- Google API call this migration can't make.
-- =====================================================================

ALTER TABLE mrv.jennifer_meeting_cycles ADD COLUMN meet_link text;

CREATE TABLE mrv.jennifer_meeting_summaries (
  summary_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        uuid NOT NULL REFERENCES mrv.jennifer_meeting_cycles(cycle_id) ON DELETE CASCADE,
  meeting_date    date NOT NULL, -- the specific Monday occurrence this row is for
  bot_id          text,          -- Recall.ai bot id, once dispatched
  status          text NOT NULL CHECK (status IN ('scheduled', 'recording', 'processing', 'sent', 'failed', 'skipped')),
  summary_text    text,
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, meeting_date)
);

CREATE INDEX idx_jennifer_meeting_summaries_status ON mrv.jennifer_meeting_summaries (status, meeting_date);

COMMENT ON TABLE mrv.jennifer_meeting_summaries IS
  'One row per weekly-meeting occurrence Jennifer has dispatched a recording bot for — tracks the bot through scheduled -> recording -> processing -> sent/failed. See src/lib/agent/scheduledTasks/jenniferMeetingSummary.ts.';

INSERT INTO mrv.scheduled_tasks (agent_id, task_key, title, frequency, next_run_at)
VALUES
  ('jennifer', 'jennifer_weekly_meeting_summary',
   'Weekly meeting: dispatch a recording bot, then transcribe + summarize in Hebrew once ready',
   'daily', now())
ON CONFLICT (task_key) DO NOTHING;

-- migrate:down
DELETE FROM mrv.scheduled_tasks WHERE task_key = 'jennifer_weekly_meeting_summary';
DROP TABLE IF EXISTS mrv.jennifer_meeting_summaries;
ALTER TABLE mrv.jennifer_meeting_cycles DROP COLUMN IF EXISTS meet_link;
