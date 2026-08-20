-- =====================================================================
-- 0046 · Real Google Calendar + Gmail tools for Jennifer
--
-- check_calendar_availability / schedule_calendar_event / list_recent_mail
-- (web/src/lib/tools/*.ts) run over auth.ts's Google session, extended
-- this migration's companion code change to request the Calendar and
-- gmail.readonly scopes alongside the existing Drive scope. Same pattern
-- as 0032 (Jennifer's Drive tools): every call runs as whichever person
-- is signed in, with exactly the access they already have by hand.
--
-- This is what unblocks the "scheduling" skill named in the TIER 2
-- blocked-tasks report (Section 2): "Extend the existing Google OAuth
-- session to include the Calendar scope, and build a calendarClient.ts
-- mirroring the Drive integration already shipped." Done.
--
-- board_protocol stays planned — still no real board-meeting content
-- source exists anywhere in this repository.
-- =====================================================================

-- migrate:up

INSERT INTO mrv.agent_action_policies (action_name, mode, note) VALUES
  ('check_calendar_availability', 'auto', 'Read-only freeBusy query.'),
  ('schedule_calendar_event', 'confirm', 'Creates a real, externally-visible calendar event — a person should see it go out.'),
  ('list_recent_mail', 'auto', 'Read-only, gmail.readonly scope only — never sends or modifies anything.');

UPDATE mrv.agents
  SET tools = tools || ARRAY['check_calendar_availability', 'schedule_calendar_event', 'list_recent_mail'],
      skills = skills || ARRAY['scheduling'],
      planned_skills = array_remove(planned_skills, 'scheduling')
  WHERE agent_id = 'jennifer';

-- migrate:down

UPDATE mrv.agents
  SET tools = array_remove(array_remove(array_remove(tools,
        'check_calendar_availability'), 'schedule_calendar_event'), 'list_recent_mail'),
      skills = array_remove(skills, 'scheduling'),
      planned_skills = planned_skills || ARRAY['scheduling']
  WHERE agent_id = 'jennifer';

DELETE FROM mrv.agent_action_policies
  WHERE action_name IN ('check_calendar_availability', 'schedule_calendar_event', 'list_recent_mail');
