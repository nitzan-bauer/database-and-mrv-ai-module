-- =====================================================================
-- 0009 · Stage 3 — the sampling lifecycle
--
--   sampling_cycles   the plan for one farm's campaign
--     └── work_orders     what a contractor is asked to do
--           ├── mcp_tokens     work-order-scoped field access
--           └── sampling_events   one capture of one point
--                 └── samples        the physical bag
--
-- Two decisions from the research are implemented here.
--
-- Sample ID is OFM + 10 zero-padded digits, settled 21 Jul 2026. The
-- spec's mockups show 8; its text, the work plan and Nitzan say 10.
-- Widening later would put two incompatible formats on physical bags.
--
-- Soil texture is a SEPARATE SAMPLE, not an extra measurement on the SOC
-- sample — a different bag and a different analysis. Cycle 1 collects it
-- at 15 cm, the middle of the 0-30 cm core, and the results define the
-- strata. VM0042 8.2.1.3(10) sanctions exactly this: "A pre-sampling of
-- 5 to 10 soil samples per stratum may provide an estimate of SOC
-- variance where up-to-date soil data are unavailable."
-- =====================================================================

-- migrate:up

-- Texture and bulk density travel as their own bags alongside the SOC
-- sample from the same core.
CREATE TYPE mrv.sample_type AS ENUM ('soc', 'texture', 'bulk_density');

-- ---------------------------------------------------------------------
-- Sample ID generator: OFM + 10 zero-padded digits -> OFM0000021615.
--
-- The sequence lives here rather than in 0001 because nothing before
-- stage 3 issues a sample. Ten digits, not the eight in the spec's
-- mockups — settled 21 Jul 2026, and free to settle now only because no
-- sample rows exist yet.
-- ---------------------------------------------------------------------
CREATE SEQUENCE mrv.sample_id_seq;

CREATE OR REPLACE FUNCTION mrv.next_sample_id() RETURNS text AS $$
  SELECT 'OFM' || lpad(nextval('mrv.sample_id_seq')::text, 10, '0');
$$ LANGUAGE sql;

COMMENT ON FUNCTION mrv.next_sample_id() IS
  'Carbonature Sample ID: OFM + 10 zero-padded digits. The spec mockups showing 8 digits are illustrative.';

-- How a stratum came to exist. Recorded because a VVB will ask, and
-- because texture-derived strata carry a provenance a hand-drawn
-- boundary does not.
CREATE TYPE mrv.stratification_method AS ENUM
  ('texture', 'soil_map', 'yield_map', 'manual', 'provisional');

-- ---------------------------------------------------------------------
-- Sampling cycles — one campaign for one farm.
--
-- Per VM0042 8.3 the interval is capped at five years. The research put
-- a number on why you would use all five: the signal accumulates while
-- the noise does not, so a 5-year interval carries roughly a fifth the
-- uncertainty deduction of an annual one at identical sampling cost.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.sampling_cycles (
  cycle_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id             uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  cycle_number        integer NOT NULL CHECK (cycle_number > 0),
  cycle_type          mrv.cycle_type NOT NULL,
  approach            mrv.quant_approach NOT NULL,

  -- Cycle 1 characterises variance and defines the strata. Defaulted
  -- from cycle_number by trigger so it cannot be forgotten.
  collect_texture     boolean NOT NULL DEFAULT false,
  texture_depth_cm    smallint DEFAULT 15
                        CHECK (texture_depth_cm IS NULL OR texture_depth_cm BETWEEN 1 AND 100),

  trigger_type        text,
  depth_scheme        text NOT NULL DEFAULT '0-15/15-30',
  planned_start       date,
  planned_end         date,

  -- Power-analysis inputs. VM0042 8.2.1.3(11) offers Equations 1 and 2
  -- and then says projects are not required to take that number, so
  -- these record intent rather than a binding constraint.
  confidence_alpha    numeric(4,3) DEFAULT 0.90 CHECK (confidence_alpha > 0 AND confidence_alpha < 1),
  power_1_minus_beta  numeric(4,3) DEFAULT 0.80 CHECK (power_1_minus_beta > 0 AND power_1_minus_beta < 1),
  mdd_target          numeric(8,3),

  same_season         boolean NOT NULL DEFAULT true,
  revisit_points      boolean NOT NULL DEFAULT true,

  status              mrv.cycle_status NOT NULL DEFAULT 'draft',
  generated_by        text NOT NULL DEFAULT 'manual',
  approved_by         uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (farm_id, cycle_number),
  CONSTRAINT cycle_window_chk
    CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CONSTRAINT cycle_approved_chk
    CHECK ((status = 'draft') OR (status = 'cancelled') OR approved_by IS NOT NULL)
);

COMMENT ON COLUMN mrv.sampling_cycles.collect_texture IS
  'Cycle 1 collects a separate texture sample per point to characterise variance and define strata (VM0042 8.2.1.3(10)).';
COMMENT ON COLUMN mrv.sampling_cycles.texture_depth_cm IS
  'Depth of the texture sub-sample, taken from the middle of the core. Default 15 cm.';

-- ---------------------------------------------------------------------
-- Work orders — the bridge from a plan to a contractor in the field.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.work_orders (
  wo_id            text PRIMARY KEY,                       -- 'WO-2026-0042'
  farm_id          uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE CASCADE,
  cycle_id         uuid NOT NULL REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE RESTRICT,
  contractor_name  text,
  contractor_email citext,
  lab_id           uuid,                                   -- FK added in stage 4 with mrv.labs
  project_lead     uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  window_start     date,
  window_end       date,
  depth_scheme     text,
  state            mrv.wo_state NOT NULL DEFAULT 'draft',
  pdf_url          text,
  issued_by        uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  issued_at        timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wo_window_chk
    CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start),
  -- A work order that has left 'draft' must record who sent it and when.
  CONSTRAINT wo_issued_chk
    CHECK (state = 'draft' OR (issued_by IS NOT NULL AND issued_at IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- MCP tokens — deferred here from stage 2 because a token is scoped to
-- a work order, and work_orders did not exist until now.
--
-- Only the hash is stored. A token readable from the database is a
-- token an auditor cannot trust, and this one grants field write access.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.mcp_tokens (
  token_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id    text NOT NULL REFERENCES mrv.work_orders(wo_id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE,
  contractor_email citext,
  issued_by        uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES mrv.users(user_id) ON DELETE SET NULL,
  last_used_at     timestamptz,

  CONSTRAINT token_expiry_chk CHECK (expires_at > issued_at)
);

-- One live token per work order; revoked ones may accumulate.
CREATE UNIQUE INDEX idx_mcp_token_one_live
  ON mrv.mcp_tokens (work_order_id) WHERE revoked_at IS NULL;

COMMENT ON COLUMN mrv.mcp_tokens.token_hash IS
  'Hash only — never the raw token. Scoped to one work order and its sampling points.';

-- ---------------------------------------------------------------------
-- Sampling events — one capture of one point in one cycle.
-- Mutable while the sampler is in the field; frozen once locked.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.sampling_events (
  event_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id               uuid NOT NULL REFERENCES mrv.sampling_points(point_id) ON DELETE RESTRICT,
  cycle_id               uuid NOT NULL REFERENCES mrv.sampling_cycles(cycle_id) ON DELETE RESTRICT,
  work_order_id          text REFERENCES mrv.work_orders(wo_id) ON DELETE SET NULL,
  sampling_date          date,
  captured_geom          geometry(Point,4326),
  gps_accuracy_m         numeric(7,2) CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m >= 0),
  distance_from_target_m numeric(8,2) CHECK (distance_from_target_m IS NULL OR distance_from_target_m >= 0),
  photo_url              text,
  field_notes            text,
  sampler_token_id       uuid REFERENCES mrv.mcp_tokens(token_id) ON DELETE SET NULL,
  locked                 boolean NOT NULL DEFAULT false,
  submitted_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (point_id, cycle_id),
  -- VM0042 8.2.1.3(9): both the intended and the actual location must be
  -- recorded, so a submitted event without coordinates is incomplete.
  CONSTRAINT event_submitted_chk
    CHECK (submitted_at IS NULL OR (captured_geom IS NOT NULL AND sampling_date IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- Samples — the physical bag. Append-only.
--
-- One event yields several bags: an SOC sample always, a texture sample
-- in cycle 1, and bulk density where taken separately. Hence the unique
-- key is (event, type, depth) rather than the event alone.
-- ---------------------------------------------------------------------
CREATE TABLE mrv.samples (
  sample_id     text PRIMARY KEY DEFAULT mrv.next_sample_id(),
  event_id      uuid NOT NULL REFERENCES mrv.sampling_events(event_id) ON DELETE RESTRICT,
  farm_id       uuid NOT NULL REFERENCES mrv.farms(farm_id) ON DELETE RESTRICT,
  sample_type   mrv.sample_type NOT NULL DEFAULT 'soc',
  stratum_code  text,
  scenario      mrv.sample_scenario NOT NULL,
  depth_top_cm  smallint CHECK (depth_top_cm IS NULL OR depth_top_cm >= 0),
  depth_base_cm smallint CHECK (depth_base_cm IS NULL OR depth_base_cm > 0),
  composite_cores smallint CHECK (composite_cores IS NULL OR composite_cores > 0),
  barcode       text,
  sampling_date date,
  shipped_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (event_id, sample_type, depth_top_cm, depth_base_cm),
  -- Equality is meaningful, not sloppy: an SOC sample spans an increment
  -- (0-15, 15-30) while a texture sample is a spot taken from the middle
  -- of the core cross-section at 15 cm, so top = base = 15.
  CONSTRAINT sample_depth_chk
    CHECK (depth_base_cm IS NULL OR depth_top_cm IS NULL OR depth_base_cm >= depth_top_cm),
  -- Only a spot sample may collapse to a single depth. An SOC sample
  -- with no thickness cannot yield a stock.
  CONSTRAINT sample_increment_chk
    CHECK (sample_type = 'texture'
           OR depth_base_cm IS NULL OR depth_top_cm IS NULL
           OR depth_base_cm > depth_top_cm)
);

COMMENT ON COLUMN mrv.samples.depth_top_cm IS
  'Top of the sampled increment. For a texture spot sample, equals depth_base_cm.';

COMMENT ON TABLE mrv.samples IS
  'Physical sample bags. Append-only: a correction is a new row. One event yields an SOC bag, plus a texture bag in cycle 1.';

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------

-- Cycle 1 is the characterisation cycle.
CREATE OR REPLACE FUNCTION mrv.default_collect_texture() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.cycle_number = 1 THEN
    NEW.collect_texture := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cycle_texture_default
  BEFORE INSERT ON mrv.sampling_cycles
  FOR EACH ROW EXECUTE FUNCTION mrv.default_collect_texture();

-- A texture sample only belongs to a cycle that asked for one.
CREATE OR REPLACE FUNCTION mrv.check_sample_against_cycle() RETURNS trigger AS $$
DECLARE
  wants_texture boolean;
BEGIN
  IF NEW.sample_type = 'texture' THEN
    SELECT c.collect_texture INTO wants_texture
    FROM mrv.sampling_events e
    JOIN mrv.sampling_cycles c ON c.cycle_id = e.cycle_id
    WHERE e.event_id = NEW.event_id;

    IF NOT coalesce(wants_texture, false) THEN
      RAISE EXCEPTION 'Texture sample % belongs to a cycle with collect_texture = false', NEW.sample_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sample_cycle_chk
  BEFORE INSERT ON mrv.samples
  FOR EACH ROW EXECUTE FUNCTION mrv.check_sample_against_cycle();

-- Field records freeze on lock. Everything except the lock flag itself.
CREATE OR REPLACE FUNCTION mrv.prevent_mutation_when_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked THEN
      RAISE EXCEPTION 'sampling_event % is locked and cannot be deleted', OLD.event_id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.locked AND NEW.locked THEN
    RAISE EXCEPTION 'sampling_event % is locked and cannot be modified', OLD.event_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_lock
  BEFORE UPDATE OR DELETE ON mrv.sampling_events
  FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation_when_locked();

-- Samples are evidence.
CREATE TRIGGER trg_samples_noupd
  BEFORE UPDATE OR DELETE ON mrv.samples
  FOR EACH ROW EXECUTE FUNCTION mrv.prevent_mutation();

-- ---------------------------------------------------------------------
-- State machines. Illegal transitions are rejected rather than logged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrv.check_wo_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;
  IF NOT (
       (OLD.state = 'draft'       AND NEW.state IN ('sent','closed'))
    OR (OLD.state = 'sent'        AND NEW.state IN ('in_progress','closed'))
    OR (OLD.state = 'in_progress' AND NEW.state IN ('completed','closed'))
    OR (OLD.state = 'completed'   AND NEW.state = 'closed')
  ) THEN
    RAISE EXCEPTION 'Illegal work order transition: % -> %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wo_transition
  BEFORE UPDATE ON mrv.work_orders
  FOR EACH ROW EXECUTE FUNCTION mrv.check_wo_transition();

CREATE OR REPLACE FUNCTION mrv.check_cycle_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
       (OLD.status = 'draft'       AND NEW.status IN ('approved','cancelled'))
    OR (OLD.status = 'approved'    AND NEW.status IN ('in_field','cancelled'))
    OR (OLD.status = 'in_field'    AND NEW.status IN ('lab_pending','cancelled'))
    OR (OLD.status = 'lab_pending' AND NEW.status IN ('complete','cancelled'))
  ) THEN
    RAISE EXCEPTION 'Illegal cycle transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cycle_transition
  BEFORE UPDATE ON mrv.sampling_cycles
  FOR EACH ROW EXECUTE FUNCTION mrv.check_cycle_transition();

-- ---------------------------------------------------------------------
-- Indexes, updated_at, audit
-- ---------------------------------------------------------------------
CREATE INDEX idx_cycles_farm      ON mrv.sampling_cycles (farm_id);
CREATE INDEX idx_wo_cycle         ON mrv.work_orders (cycle_id);
CREATE INDEX idx_wo_farm          ON mrv.work_orders (farm_id);
CREATE INDEX idx_wo_state         ON mrv.work_orders (state) WHERE state <> 'closed';
CREATE INDEX idx_events_point     ON mrv.sampling_events (point_id);
CREATE INDEX idx_events_cycle     ON mrv.sampling_events (cycle_id);
CREATE INDEX idx_events_wo        ON mrv.sampling_events (work_order_id);
CREATE INDEX idx_events_geom      ON mrv.sampling_events USING gist (captured_geom);
CREATE INDEX idx_samples_event    ON mrv.samples (event_id);
CREATE INDEX idx_samples_farm     ON mrv.samples (farm_id);
CREATE INDEX idx_samples_type     ON mrv.samples (sample_type);
CREATE INDEX idx_tokens_wo        ON mrv.mcp_tokens (work_order_id);

CREATE TRIGGER trg_cycles_upd BEFORE UPDATE ON mrv.sampling_cycles FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_wo_upd     BEFORE UPDATE ON mrv.work_orders     FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();
CREATE TRIGGER trg_events_upd BEFORE UPDATE ON mrv.sampling_events FOR EACH ROW EXECUTE FUNCTION mrv.set_updated_at();

CREATE TRIGGER trg_audit_cycles AFTER INSERT OR UPDATE OR DELETE ON mrv.sampling_cycles
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('cycle_id');
CREATE TRIGGER trg_audit_wo     AFTER INSERT OR UPDATE OR DELETE ON mrv.work_orders
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('wo_id');
CREATE TRIGGER trg_audit_events AFTER INSERT OR UPDATE OR DELETE ON mrv.sampling_events
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('event_id');
CREATE TRIGGER trg_audit_samples AFTER INSERT ON mrv.samples
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('sample_id');
CREATE TRIGGER trg_audit_tokens AFTER INSERT OR UPDATE OR DELETE ON mrv.mcp_tokens
  FOR EACH ROW EXECUTE FUNCTION mrv.log_change('token_id');

-- migrate:down

DROP TRIGGER IF EXISTS trg_audit_tokens  ON mrv.mcp_tokens;
DROP TRIGGER IF EXISTS trg_audit_samples ON mrv.samples;
DROP TRIGGER IF EXISTS trg_audit_events  ON mrv.sampling_events;
DROP TRIGGER IF EXISTS trg_audit_wo      ON mrv.work_orders;
DROP TRIGGER IF EXISTS trg_audit_cycles  ON mrv.sampling_cycles;
DROP TRIGGER IF EXISTS trg_samples_noupd ON mrv.samples;
DROP TRIGGER IF EXISTS trg_events_lock   ON mrv.sampling_events;

DROP TABLE IF EXISTS mrv.samples;
DROP TABLE IF EXISTS mrv.sampling_events;
DROP TABLE IF EXISTS mrv.mcp_tokens;
DROP TABLE IF EXISTS mrv.work_orders;
DROP TABLE IF EXISTS mrv.sampling_cycles;

DROP FUNCTION IF EXISTS mrv.check_cycle_transition();
DROP FUNCTION IF EXISTS mrv.check_wo_transition();
DROP FUNCTION IF EXISTS mrv.prevent_mutation_when_locked();
DROP FUNCTION IF EXISTS mrv.check_sample_against_cycle();
DROP FUNCTION IF EXISTS mrv.default_collect_texture();
DROP FUNCTION IF EXISTS mrv.next_sample_id();
DROP SEQUENCE IF EXISTS mrv.sample_id_seq;

DROP TYPE IF EXISTS mrv.stratification_method;
DROP TYPE IF EXISTS mrv.sample_type;
