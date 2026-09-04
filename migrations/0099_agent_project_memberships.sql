-- migrate:up
-- =====================================================================
-- 0099 — explicit, auditable project access for the AI agent personas
-- (Addendum 2, Part C). Until now an agent's real access was whatever its
-- scheduled-task code or chat-turn tool calls happened to reach — nothing
-- visible from a single screen. Ron already got a real mrv.users row and
-- an mrv.project_memberships row (role='ai_agent') via the shared-identity
-- work; this does the same for the other four agent personas, each using
-- their own real per-agent email alias (Google Workspace send-as identity)
-- as the row's email, matching the exact shape Ron's row already has.
--
-- Scope: mrv.projects only has one real grouped project today
-- (CARBO-3988 — the same TARGET_PROJECT_ID every scheduled task and the
-- Addendum 3 chat-turn lesson loop already hardcode) plus its demo
-- counterpart. Every agent's real tools operate against CARBO-3988, so
-- that is the only grant made here. A future project would need its own
-- row per agent — this is a starting audit, not a one-time lockdown; see
-- the Addendum 2 Part C note on granting/revoking being a plain row edit.
-- =====================================================================

INSERT INTO mrv.users (email, full_name, org_id, auth_method)
SELECT v.email, v.full_name, o.org_id, 'sso'
FROM (VALUES
  ('dave@carbonature.io', 'Dave'),
  ('jennifer@carbonature.io', 'Jennifer'),
  ('john@carbonature.io', 'John'),
  ('rebeka@carbonature.io', 'Rebeka')
) AS v(email, full_name)
CROSS JOIN (SELECT org_id FROM mrv.organizations WHERE name = 'CarboNature' LIMIT 1) AS o
ON CONFLICT (email) DO NOTHING;

INSERT INTO mrv.project_memberships (user_id, project_id, role)
SELECT u.user_id, 'CARBO-3988', 'ai_agent'
FROM mrv.users u
WHERE u.email IN ('dave@carbonature.io', 'jennifer@carbonature.io', 'john@carbonature.io', 'rebeka@carbonature.io')
ON CONFLICT (user_id, project_id) DO NOTHING;

-- migrate:down
DELETE FROM mrv.project_memberships
WHERE role = 'ai_agent'
  AND user_id IN (SELECT user_id FROM mrv.users WHERE email IN (
    'dave@carbonature.io', 'jennifer@carbonature.io', 'john@carbonature.io', 'rebeka@carbonature.io'
  ));
DELETE FROM mrv.users
WHERE email IN ('dave@carbonature.io', 'jennifer@carbonature.io', 'john@carbonature.io', 'rebeka@carbonature.io');
