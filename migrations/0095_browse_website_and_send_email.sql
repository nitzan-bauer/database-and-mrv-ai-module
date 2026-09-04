-- migrate:up
-- =====================================================================
-- 0095 — browse_website and send_email, for Rebeka and Dave.
--
-- Rebeka was asked, via the "Ask" chat panel, to explore Haifa Group's
-- product pages and email a recommendation. She gave a correct, honest
-- answer explaining she couldn't: fetch_public_url (0041) reads exactly
-- one URL and never follows a link from it, and her only tool that
-- sends anything, run_pdd_generator_pipeline, emails one specific
-- auto-generated PDD PDF for one project — not a free-form report.
-- There was no send_email tool anywhere; email only ever happened
-- inside hardcoded pipelines (runPddGeneratorPipeline.ts,
-- scheduledTaskReport.ts, jenniferWeeklyMeetingCycle.ts) calling
-- sendGmailMessage directly, never as something an agent decides to
-- invoke mid-turn.
--
-- browse_website (src/lib/tools/browseWebsite.ts) closes the first gap
-- by walking a start page's same-origin links breadth-first, up to a
-- capped number of pages — reusing fetch_public_url's own fetch and
-- SSRF-check logic for every page it touches, not a looser copy of it.
-- send_email (src/lib/tools/sendEmail.ts) closes the second by reusing
-- sendGmailMessage exactly as every existing caller does, including the
-- per-agent "send as" alias (agentSenderEmail) — deliberately locked to
-- nitzan@carbonature.io, matching every existing caller, with no
-- free-form recipient.
--
-- 'auto' for both: browse_website carries the same read-only, reaches-
-- the-public-internet risk profile fetch_public_url is already 'auto'
-- for, just walking a few more same-origin pages under the identical
-- safety rules. send_email is 'auto' because 'confirm' would be
-- unusable today — there is no UI yet for a human to approve and
-- resubmit a held call — and every scheduled task already emails
-- Nitzan today without a confirmation step of its own; this does not
-- lower that existing bar.
--
-- Dave's role_prompt gets a short addition: his vvb_liaison skill
-- (0042) currently interfaces with the VVB only as "a tracker... not
-- actual VVB communication" — a description these two real tools now
-- make partly out of date. Rebeka's role_prompt needs no change:
-- nothing in it contradicts these tools the way Dave's vvb_liaison text
-- does, and she already discovered fetch_public_url's own limits
-- unprompted.
-- =====================================================================

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('browse_website', 'auto', 'Read-only, same-origin multi-page fetch; commits nothing externally.'),
  ('send_email', 'auto', 'Sends to nitzan@carbonature.io only — no free-form recipient.')
ON CONFLICT (action_name) DO NOTHING;

UPDATE mrv.agents
   SET tools = tools || ARRAY['browse_website', 'send_email']::text[]
 WHERE agent_id IN ('rebeka', 'dave')
   AND NOT ('browse_website' = ANY (tools));

UPDATE mrv.agents
   SET role_prompt = role_prompt || E'\n\nThat VVB interface is now backed by real tools, not just a tracker: use browse_website to actually check a VVB''s, methodology''s, or supplier''s public pages when a submission or input needs verifying, and send_email to send real correspondence once a finding or sign-off is ready — not only to log that it happened.'
 WHERE agent_id = 'dave'
   AND role_prompt NOT LIKE '%That VVB interface is now backed by real tools%';

-- migrate:down
UPDATE mrv.agents
   SET role_prompt = regexp_replace(
         role_prompt,
         E'\n\nThat VVB interface is now backed by real tools.*$',
         ''
       )
 WHERE agent_id = 'dave';

UPDATE mrv.agents
   SET tools = array_remove(array_remove(tools, 'browse_website'), 'send_email')
 WHERE agent_id IN ('rebeka', 'dave');

DELETE FROM mrv.agent_action_policies WHERE action_name IN ('browse_website', 'send_email');
