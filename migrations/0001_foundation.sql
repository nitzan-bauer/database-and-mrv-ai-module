-- =====================================================================
-- 0001 · Foundation — schema, extensions, helper functions
-- CarboNature MRV database · Stage A
--
-- Everything lives in the `mrv` schema so this database can later be
-- merged into the existing Supabase project (whose `public` schema holds
-- the marketplace/Sale-Flow tables) without a single name collision.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS mrv;

-- Extensions are installed into `public` (Supabase convention) and used
-- from `mrv` via the search_path set below.
CREATE EXTENSION IF NOT EXISTS postgis;   -- spatial types & indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

SET search_path = mrv, public;

-- ---------------------------------------------------------------------
-- Helper: maintain updated_at on mutable tables
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrv.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Helper: hard append-only guard — block every UPDATE/DELETE.
-- Verra audit trail: a correction is a NEW row, never an edit.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrv.prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only: % is not permitted. Insert a correcting row instead.',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Helper: area of a geography-correct polygon, in hectares.
-- Casting 4326 geometry to geography gives metres² on the spheroid,
-- which is what VM0042 area reporting needs (planar ST_Area on 4326
-- would return square degrees).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mrv.area_ha(g geometry) RETURNS numeric AS $$
  SELECT round((ST_Area(g::geography) / 10000.0)::numeric, 4);
$$ LANGUAGE sql IMMUTABLE STRICT;
