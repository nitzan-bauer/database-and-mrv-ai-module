-- migrate:up
-- =====================================================================
-- 0100 — mrv.users becomes the platform-wide identity table (Addendum 2,
-- Part A). Until now every row here was staff-shaped (org_id NOT NULL).
-- This makes room for every human on the platform, including farmers and
-- credit buyers, WITHOUT touching how they sign in, what they see, or
-- their SaaS session — Supabase Auth stays exactly as it is for them.
-- This only adds a directory row behind the scenes.
--
-- Two changes:
--   1. org_id becomes nullable — a customer has none.
--   2. is_staff distinguishes a real staff/agent identity from a
--      directory-only customer row. Every row that already exists here
--      today (Nitzan, Ron, and the four agent personas from 0099) is
--      staff by definition — backfilled true below.
--
-- A row that originates from the SaaS uses the SAME id as
-- public.profiles.id — not a fresh uuid with a bridge column pointing
-- sideways. One identity, one id, so any future join is a plain `=`.
-- This is only possible because MRV and the SaaS are already one physical
-- database (Addendum 1) — a cross-database FK could never do this.
-- Staff rows are unaffected: they keep generating their own uuid exactly
-- as before (matched by email, per the existing ensureMrvUser pattern),
-- since a staff person isn't necessarily a public.profiles row at all.
-- =====================================================================

ALTER TABLE mrv.users ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE mrv.users ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mrv.users.is_staff IS
  'true = a real staff/agent identity (org_id set, its own generated user_id, matched across apps by email). false = a directory-only SaaS customer row (farmer/credit_buyer) whose user_id is the SAME value as public.profiles.id. listAdminUsers() filters to is_staff = true — a directory of every farmer is not what that screen is for.';

UPDATE mrv.users SET is_staff = true;

-- One-time backfill: every existing farmer/credit_buyer profile gets a
-- matching row here, id-for-id. New sign-ups get this from the SaaS's own
-- ensureMrvCustomerIdentity() going forward (registration + dashboard
-- visits) — this statement only covers accounts that already existed
-- before this migration ran.
INSERT INTO mrv.users (user_id, supabase_user_id, org_id, email, full_name, auth_method, is_staff, seen_apps)
SELECT p.id, p.id, NULL, lower(p.email), p.username, 'password', false, ARRAY['saas']
FROM public.profiles p
WHERE p.role IN ('farmer', 'credit_buyer')
ON CONFLICT (user_id) DO NOTHING;

-- migrate:down
DELETE FROM mrv.users WHERE is_staff = false;
ALTER TABLE mrv.users DROP COLUMN is_staff;
ALTER TABLE mrv.users ALTER COLUMN org_id SET NOT NULL;
