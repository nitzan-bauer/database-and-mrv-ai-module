# Schema & naming conventions

Fixed in Stage 0. Everything from Stage 1 onward follows these without re-deciding.

---

## Schema

Everything lives in **`mrv`**. Nothing in `public` except extensions.

This costs nothing now and buys the option later: if the module ends up inside the existing Supabase project, `mrv.farms` and `public.farms` coexist without a rename. Set `search_path = mrv, public` at the top of every migration.

## Naming

| Object | Rule | Example |
|---|---|---|
| Tables | `snake_case`, **plural** | `sampling_points` |
| Columns | `snake_case`, **singular** | `sampling_date` |
| Primary key | `<singular_table>_id` | `plot_id`, `farm_id` |
| Foreign key | Same name as the key it points at | `farm_id` references `farms.farm_id` |
| Enum types | `snake_case`, singular | `cycle_status` |
| Indexes | `idx_<table>_<column(s)>` | `idx_plots_farm` |
| Spatial indexes | `idx_<table>_<geom_column>` | `idx_plots_geom` |
| Triggers | `trg_<abbrev>_<purpose>` | `trg_plots_upd` |
| Constraints | `<subject>_chk` | `bsl_distance_chk` |
| Functions | verb or noun, `snake_case` | `soc_stock_t_per_ha()` |

Two deliberate exceptions, both because an external system already named them: `plot_id` and `bsl_id` are `text` rather than `uuid`, because CropNut and the field paperwork use human-readable identifiers (`KIS-WP-01`, `BSL-01`) and forcing a UUID would mean carrying a second lookup on every lab sheet and work order.

## Units, baked into column names

Ambiguous units are how MRV data quietly goes wrong. Any column whose unit is not self-evident carries it:

`area_ha`, `distance_km`, `depth_cm`, `soc_t_per_ha`, `credits_tco2e`, `cost_usd`, `sfc_l_per_kwh`, `n_content` (documented as t N / t product).

## Types

- **Timestamps** — `timestamptz` everywhere, never `timestamp`. Field data arrives from Kenya and Tanzania; a naive timestamp is a bug waiting for the first cross-border cycle.
- **Dates** — `date` for things that genuinely have no time-of-day (`sampling_date`, `joined_at`).
- **Money and measurements** — `numeric` with explicit precision, never `float`. `numeric(12,4)` for areas and stocks, `numeric(14,2)` for currency.
- **Geometry** — `geometry(Polygon,4326)` / `geometry(Point,4326)`. The SRID is part of the type, so a wrong-projection insert is rejected by Postgres rather than silently mis-locating a plot.
- **Email** — `citext`, so case never causes a duplicate account.
- **Identifiers** — `uuid` with `gen_random_uuid()` by default; `text` only where an external system owns the identifier.

## Areas

`ST_Area` on a 4326 geometry returns **square degrees**, which is meaningless. Always go through `mrv.area_ha(geom)`, which casts to `geography` first.

Stored `area_ha` columns are not generated. Reported areas must stay frozen for audit even if a polygon is later corrected, so the stored value is written deliberately and `mrv.area_ha()` is used to check for drift.

## Deletion policy

- `ON DELETE CASCADE` — where the child is meaningless without the parent (`strata` under `plots`).
- `ON DELETE RESTRICT` — anywhere field or lab evidence hangs off the row. You cannot delete a plot that has samples; that is the point.
- `ON DELETE SET NULL` — optional references (`granted_by`, `linked_plot_id`).

## Append-only

Evidentiary tables carry `mrv.prevent_mutation()` on `BEFORE UPDATE OR DELETE`. A correction is a new row.

Currently: `audit_log`, `ghg_parameters`. Stage 3-4 adds `samples`, `soc_measurements`, `lab_imports`, `import_quarantine`.

`sampling_events` is the exception — mutable while the sampler is still in the field, frozen the moment `locked = true`.

## Migrations

**dbmate**, plain `.sql` files with `-- migrate:up` and `-- migrate:down` sections.

Alembic was the work plan's suggestion, conditional on FastAPI/SQLAlchemy. Passed over because this schema is almost entirely things Alembic's autogenerate cannot see: PostGIS geometry columns, GIST indexes, plpgsql functions, triggers, enums, partial unique indexes, and CHECK constraints encoding methodology rules. You would write `op.execute("""...raw SQL...""")` for nearly every migration, which is Alembic-shaped overhead around SQL you wrote anyway.

Plain SQL also survives a change of application language. If the ingestion service does end up being FastAPI, these files drop into Alembic's `op.execute()` unchanged; if it ends up being a Next.js route, they still work.

Rules:

- Filenames `NNNN_short_name.sql`, sequential.
- Every migration has a working `down`. CI unwinds the entire stack and rebuilds it on every run, so a broken `down` fails the build.
- Never edit an applied migration. Add a new one.
- Seeds are separate from migrations, live in `seeds/`, and must be idempotent (`ON CONFLICT DO NOTHING` or a `WHERE NOT EXISTS` guard). CI applies them twice to prove it.

## Comments

`COMMENT ON` for anything whose reason is not obvious from the name — particularly where a column encodes a methodology rule. These survive into the database itself, so `\d+` and any schema browser show them, and the AI agent can read them at query time.
