-- =====================================================================
-- 0001 · Foundation — schema, extensions, helper functions
-- CarboNature MRV database · Stage A
--
-- Everything lives in the `mrv` schema so this database can later be
-- merged into the existing Supabase project (whose `public` schema holds
-- the marketplace/Sale-Flow tables) without a single name collision.
-- =====================================================================

-- migrate:up

CREATE SCHEMA IF NOT EXISTS mrv;

-- Extensions live in `public`. Every object below is schema-qualified,
-- so no search_path is set: leaving one set at the end of a migration
-- makes dbmate look for its schema_migrations table in `mrv`.
CREATE EXTENSION IF NOT EXISTS postgis;   -- spatial types & indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector — agent_memory embeddings (stage 2)

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

-- migrate:down

DROP FUNCTION IF EXISTS mrv.area_ha(geometry);
DROP FUNCTION IF EXISTS mrv.prevent_mutation();
DROP FUNCTION IF EXISTS mrv.set_updated_at();
DROP SCHEMA IF EXISTS mrv;
-- Extensions are left installed: other schemas in the database may use them.
