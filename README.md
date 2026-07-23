# CarboNature — Database & MRV AI-Module

The soil-carbon MRV backbone for CarboNature's Verra **VM0042 v2.2** projects: the database first, then the AI-driven soil-sampling and carbon-modelling module that runs on top of it.

This is a separate system from the customer-facing SaaS (`carbonature-saas`, the marketplace and Sale Flow). The two meet at the farm and plot level, but this database owns the verification lineage — samples, lab results, SOC stocks, model runs, and the audit trail a VVB will read.

---

## Where things stand

**All seven database stages are done and live.** RDS PostgreSQL 16.13 with PostGIS and pgvector runs in eu-west-1; sixteen migrations are applied and 30 verification checks pass against the real instance. The database is complete; the AI-MRV module is the next phase.

**Everything seeded so far is DEMO data.** Elad Farm and Nitzan-Veg-Tech Farm are demonstration farms, not clients. This is enforced by trigger, not convention — see [docs/STAGE-1.md](docs/STAGE-1.md).

Everything lives in a dedicated `mrv` Postgres schema, so this can be merged into the existing Supabase project later without a single table-name collision.

Billing runs on AWS Free-plan credits, not the card. See [docs/STAGE-0.md](docs/STAGE-0.md) for endpoints, credentials and the credit runway, and [docs/ROADMAP.md](docs/ROADMAP.md) for stage-by-stage status.

---

## Layout

```
infra/terraform/   RDS, VPC, KMS, S3 — the Stage 0 stack
migrations/        Schema, dbmate format, applied in filename order
seeds/             Reference data extracted from the GHG calculator workbook
scripts/           apply.sh (psql path) + verify.sql (post-apply checks)
docs/              Per-stage records, conventions, roadmap, capacity + source analysis
docs/source/       The two input documents + the v1 DDL, for provenance
```

## Applying it

With dbmate, which is the supported path:

```bash
dbmate --migrations-dir ./migrations up
psql "$DATABASE_URL" -f seeds/0001_reference_data.sql
psql "$DATABASE_URL" -f scripts/verify.sql
```

Or `DATABASE_URL="postgresql://..." ./scripts/apply.sh` to do all three with plain psql.

Every line of the verify output should read `PASS`. It probes the guarantees rather than just counting objects: that `audit_log` and `ghg_parameters` reject `UPDATE`, that a baseline control site beyond 250 km is refused, and that the SOC formula returns 19.5 t C/ha for the worked example.

CI runs all of this on every push against PostgreSQL 16 + PostGIS + pgvector, and additionally unwinds every migration and rebuilds the stack — so a broken `down` migration fails the build.

---

## The data model in one picture

```
organizations
  └── projects                    grouped Verra project — the VCU issuance unit
        └── farms                 participant instance (= CropNut "installation")
              ├── plots           WP polygons; quantification approach lives here
              │     └── strata
              │           └── sampling_points
              └── baseline_control_sites (QA2)
                    └── sampling_points
```

Three decisions worth knowing before reading the SQL:

**Each farm is self-contained.** Its own plots, its own baseline control sites, its own strata, and its own sampling campaign. `projects` stays deliberately thin — Verra registration and, later, VCU issuance. Everything operational hangs off the farm.

**The quantification approach sits on the plot, not the project.** A single farm can run QA1 and QA2 side by side, and VM0042 §8.1 requires strata on different approaches to be accounted separately.

**Evidentiary tables are append-only, enforced by trigger.** A correction is a new row, never an edit. This is what makes the data verifiable rather than merely stored.

---

## Stage plan

| Stage | Scope | Status |
|---|---|---|
| **0** | Infrastructure: RDS + PostGIS, S3 + KMS, VPC, migration tooling, conventions, CI | **Done — provisioned and verified** |
| **1** | Spatial schema + seed the demo farms | **Done — 2 farms, 7 plots live** |
| **2** | Permissions, tokens, audit | **Done** — `mcp_tokens` moved to stage 3 |
| **3** | Sampling lifecycle | **Done — 5 tables, state machines, texture as its own sample type** |
| **4** | Lab ingestion + SOC schema | **Done — 6 tables, DIN 19539 fractions, ESM inputs** |
| **5** | Credits & compliance | **Done — commercial + QA3 emissions engine + 8 hard checks** |
| **6** | QA1 model structures | **Done — model_runs, model_results, mvr (integration deferred)** |
| **7** | Hardening, backups, audit-readiness | **Done — audit-readiness views + billing/storage alarms** |

41 base tables, plus four views (v_real_plots, v_plot_credits, v_sample_chain, v_data_completeness). All 23 enum types are created up front, so later stages add tables without revisiting type definitions.

Per-stage records: [STAGE-0](docs/STAGE-0.md) · [STAGE-1](docs/STAGE-1.md) · [STAGE-2](docs/STAGE-2.md) · [STAGE-3](docs/STAGE-3.md) · [STAGE-4](docs/STAGE-4.md) · [STAGE-5](docs/STAGE-5.md) · [STAGE-6](docs/STAGE-6.md) · [STAGE-7](docs/STAGE-7.md). Regulatory research: [REGULATORY-BASIS](docs/REGULATORY-BASIS.md) · [SAMPLE-SIZE-OPTIMISATION](docs/SAMPLE-SIZE-OPTIMISATION.md). Capacity measurements and the raster decision: [GIS-CAPACITY](docs/GIS-CAPACITY.md). [ROADMAP](docs/ROADMAP.md) has the open questions attached to each stage.

---

## Source documents

Both live in [`docs/source/`](docs/source/):

- **`Carbonature_AI_Soil_Module_Spec_v1.0.pdf`** — the functional specification (April 2026). Nine screens, four personas, a three-tier delivery backlog, and the canonical CropNut SOC schema. Predates several decisions since taken; see [docs/SPEC-DELTAS.md](docs/SPEC-DELTAS.md) for where it is now out of date.
- **`GHG_Calculator_VM0042_v2.2_OpenField_v1.xlsx`** — the working ERR quantification spreadsheet. Its emission factors, fertilizer library, and equations are the source for `migrations/0004` and `seeds/0001`. See [docs/GHG-CALCULATOR.md](docs/GHG-CALCULATOR.md).
- **`mrv_schema_v1_from_desktop_chat.sql`** — the original 31-table DDL this repo's Stage A is derived from, kept for provenance.

---

## One correction already applied

The functional spec (§11) gives the SOC stock formula with a ×1000 factor. The GHG calculator (Equations sheet, eq. 4/5) and standard IPCC/Verra practice both give ×100. The calculator is right:

```
TOC 1%, BD 1.3 g/cm³, depth 15 cm
  ×100  →  0.01 × 1.3 × 15 × 100 = 19.5 t C/ha   ✓ plausible for 0-15 cm
  ×1000 →  195 t C/ha                            ✗ an order of magnitude high
```

`mrv.soc_stock_t_per_ha()` implements the ×100 form, and `scripts/verify.sql` asserts it. Worth confirming with CropNut in writing before the first real lab import, since the spec text says otherwise.
