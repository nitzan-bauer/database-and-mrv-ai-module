-- =====================================================================
-- 0005 · Audit log & agent policy
--
-- Verra verification hinges on traceability: who did what, when, and —
-- for the AI agent — on what reasoning. Append-only, enforced by trigger.
-- =====================================================================

-- migrate:up

-- Polymorphic target (no FK) so any object type can be referenced,
-- including rows that were later archived or belong to future tables.
CREATE TABLE mrv.audit_log (
  audit_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor       text NOT NULL,              -- user id, 'ai_agent', or token id
  actor_role  mrv.app_role,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  payload     jsonb,                      -- inputs / agent reasoning chain
  session_id  uuid,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_target ON mrv.audit_log (target_type, target_id);
CREATE INDEX idx_audit_ts     ON mrv.audit_log (ts DESC);
CREATE INDEX idx_audit_actor  ON mrv.audit_log (actor, ts DESC);

CREATE TRIGGER trg_audit_noupd
  BEFORE UPDATE OR DELETE ON mrv.audit_log
  FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

COMMENT ON TABLE mrv.audit_log IS
  'Append-only. Retention: project lifetime + 5 years. Polymorphic target_type/target_id (no FK by design).';

-- ---------------------------------------------------------------------
-- Per-action AI agent policy: AUTO / CONFIRM / OFF.
-- Default is CONFIRM for anything that creates or modifies an artifact.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.agent_action_policies (
  policy_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name text NOT NULL UNIQUE,
  mode        mrv.agent_mode NOT NULL DEFAULT 'confirm',
  note        text,
  updated_by  uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_agent_pol_upd
  BEFORE UPDATE ON mrv.agent_action_policies
  FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

-- migrate:down

DROP TABLE IF EXISTS mrv.agent_action_policies;
-- audit_log carries the append-only trigger; drop it explicitly first so
-- the DROP TABLE is not blocked by the guard.
DROP TRIGGER IF EXISTS trg_audit_noupd ON mrv.audit_log;
DROP TABLE IF EXISTS mrv.audit_log;
