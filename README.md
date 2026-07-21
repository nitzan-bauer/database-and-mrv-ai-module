# CarboNature — Database & MRV AI-Module

The soil-carbon MRV backbone for CarboNature's Verra **VM0042 v2.2** projects: the database first, then the AI-driven soil-sampling and carbon-modelling module that runs on top of it.

This is a separate system from the customer-facing SaaS (`carbonature-saas`, the marketplace and Sale Flow). The two meet at the farm and plot level, but this database owns the verification lineage — samples, lab results, SOC stocks, model runs, and the audit trail a VVB will read.

---

## Where things stand

**Stage A of the database is built** (this repo). Nothing has been applied to a live database yet.

Everything lives in a dedicated `mrv` Postgres schema, so this can run as its own database now and be merged into the existing Supabase project later without a single table-name collision.

---

## Layout

```
migrations/     Stage A schema, applied in filename order
seeds/          Reference data extracted from the GHG calculator workbook
scripts/        apply.sh (run everything) + verify.sql (post-apply checks)
docs/           Roadmap, data-model notes, and the source documents
docs/source/    The two input documents + the v1 DDL from the Desktop chat
```

## Applying it

```bash
DATABASE_URL="postgresql://..." ./scripts/apply.sh
```

Run it against a branch or a backup first. `scripts/verify.sql` runs automatically at the end and should report `PASS` on every line; its last two statements deliberately trigger the append-only guard, so an exception there is the expected result.

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
| **A** | Foundation: schema, extensions, enums, core spatial hierarchy, reference data, audit log | **Built** |
| **B** | Sampling lifecycle: cycles, work orders, MCP tokens, sampling events, samples, lab imports, SOC measurements, ESM | Next |
| **C** | Modelling & credits: model runs and results, MVR, GHG activity data and computed emissions, leakage, credits, VCU issuances, compliance engine | Planned |

Stage A creates 11 tables. All enum types for later stages are created up front, so B and C add tables without revisiting type definitions.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what each stage contains and the open questions attached to it.

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
