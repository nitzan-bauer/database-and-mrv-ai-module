-- migrate:up
-- =====================================================================
-- 0078 — mrv.agent_feedback: a real, generic human-verdict signal.
--
-- Nitzan asked for agents that "learn and improve like Machine
-- Learning, with a real learning curve per agent." Confirmed live
-- (web search) Anthropic offers no public fine-tuning of Claude — no
-- weights retrain here. What's actually buildable, and what real
-- production LLM-agent systems do, is continual in-context learning:
-- every action leaves a structured trace, that trace becomes
-- retrievable memory, future prompts are assembled with it. This
-- table is the human-verdict half of that trace.
--
-- Until now the only real approval signal anywhere was
-- mrv.pdd_section_status.dev_approved (0067) — a boolean, scoped only
-- to PDD sections, with no link to which agent/action produced the
-- work. This is the generic version any future feedback surface (a
-- thumbs-up on a scheduled-task email, a reject-and-explain button on
-- any drafted output) writes into with the same shape.
-- =====================================================================

CREATE TABLE mrv.agent_feedback (
  feedback_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        text NOT NULL REFERENCES mrv.agents(agent_id),
  action_name     text NOT NULL,
  target_type     text,
  target_id       text,
  verdict         text NOT NULL CHECK (verdict IN ('approved', 'corrected', 'rejected')),
  correction_text text,
  given_by        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_feedback_agent ON mrv.agent_feedback (agent_id, created_at DESC);
CREATE INDEX idx_agent_feedback_target ON mrv.agent_feedback (target_type, target_id);

COMMENT ON TABLE mrv.agent_feedback IS
  'Generic human-verdict signal on an agent action — approved/corrected/rejected. The PDD Development "Approve" button (0067) writes verdict=approved here in addition to its own dev_approved flag; this is the seam any future feedback UI plugs into with the same shape.';

INSERT INTO mrv.agent_action_policies (action_name, mode, note)
VALUES ('record_agent_feedback', 'auto', 'A human records their own verdict on an agent''s work — not an agent action, but registered so it audits the same way.')
ON CONFLICT (action_name) DO NOTHING;

-- migrate:down
DELETE FROM mrv.agent_action_policies WHERE action_name = 'record_agent_feedback';
DROP TABLE IF EXISTS mrv.agent_feedback;
