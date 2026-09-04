-- migrate:up
-- =====================================================================
-- 0097 — track which app(s) a shared mrv.users identity has actually
-- signed into (mrv / crm / saas), so the admin console's "One admin,
-- three systems" tile can report real per-system counts instead of
-- hardcoding every row as "MRV" — the identity table is genuinely
-- shared (CRM's ensureMrvUser.ts and the SaaS's own ensureMrvUser.ts
-- both upsert into this same table on sign-in), but until now nothing
-- recorded which app(s) a given person actually authenticates through.
-- An array, not a single "last seen" value, because a real person (e.g.
-- Nitzan) genuinely signs into more than one of these apps — a single
-- column would just flip between them and undercount every tile.
-- =====================================================================

ALTER TABLE mrv.users ADD COLUMN IF NOT EXISTS seen_apps text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN mrv.users.seen_apps IS
  'Every app (mrv/crm/saas) this identity has actually signed into — appended to, never overwritten, on each app''s own sign-in upsert. Used by the admin console to tag a user''s system(s) in the "One admin, three systems" view. Empty for a pre-existing row that predates this column, until its next sign-in.';

-- migrate:down
ALTER TABLE mrv.users DROP COLUMN IF EXISTS seen_apps;
