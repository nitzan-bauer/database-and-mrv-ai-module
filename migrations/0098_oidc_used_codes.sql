-- migrate:up
-- =====================================================================
-- 0098 — replay guard for the staff SSO bridge's one-time authorization
-- codes (Addendum 2, Part B). The code itself is a short-lived (60s)
-- signed JWT — self-verifying, no DB lookup needed to trust its claims —
-- but a signed, unexpired JWT that leaked (browser history, a referrer
-- header, a shared clipboard) would otherwise be replayable any number
-- of times within that window. Each code's jti is recorded here the
-- first time it's exchanged; a second exchange attempt is rejected.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mrv.oidc_used_codes (
  jti      uuid PRIMARY KEY,
  used_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mrv.oidc_used_codes IS
  'One row per staff-SSO-bridge authorization code already exchanged (Addendum 2 Part B) — a second exchange of the same jti is a replay and is rejected. Rows older than a few minutes are safe to prune (the code itself expires in 60s); nothing currently prunes automatically since the table stays tiny.';

-- migrate:down
DROP TABLE IF EXISTS mrv.oidc_used_codes;
