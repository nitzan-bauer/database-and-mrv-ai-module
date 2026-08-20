-- migrate:up
-- =====================================================================
-- 0072 — persist the Google refresh token, agent-agnostic (Nitzan's
-- own scheduled-tasks-for-every-agent request, live this session).
--
-- src/auth.ts's Google provider already requests access_type=offline
-- + prompt=select_account consent, so Google already hands back a real
-- refresh_token on every sign-in — today it only ever lives inside the
-- signed-in browser's encrypted JWT cookie (12h session), never
-- persisted. An unattended run (a cron job with no browser open) has
-- no session to draw a token from, so every Drive/Gmail tool fails
-- cleanly today by design (src/lib/tools/context.ts's own comment on
-- googleAccessToken). This column is what lets a cron job mint a fresh
-- access token on its own, server-side, for the one real connected
-- Workspace identity in this system.
-- =====================================================================

ALTER TABLE mrv.users
  ADD COLUMN google_refresh_token text,
  ADD COLUMN google_refresh_token_updated_at timestamptz;

COMMENT ON COLUMN mrv.users.google_refresh_token IS
  'Persisted from the JWT sign-in callback (src/auth.ts) so an unattended job (cron) can mint a fresh Google access token without a live browser session.';

-- migrate:down
ALTER TABLE mrv.users
  DROP COLUMN IF EXISTS google_refresh_token,
  DROP COLUMN IF EXISTS google_refresh_token_updated_at;
