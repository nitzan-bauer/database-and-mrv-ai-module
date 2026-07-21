# Roadmap

Stage numbering follows the work plan of record (July 2026). The database is finished before AI-MRV module development starts.

An earlier draft of this file used an A/B/C lettering; that is superseded. What it called "Stage A" is now spread across stages 1, 2 and part of 5 below.

| Stage | Scope | Status |
|---|---|---|
| **0** | Infrastructure | Code complete, not provisioned |
| **1** | Spatial schema + seeding the existing projects | Schema built, seeding pending |
| **2** | Permissions, tokens, audit | Partly built |
| **3** | Sampling lifecycle | Not started |
| **4** | Lab ingestion + SOC schema | Not started |
| **5** | Credits & compliance | Reference data built |
| **6** | QA1 model structures | Not started |
| **7** | Hardening, backups, audit-readiness | Ongoing from stage 6 |

---

## Stage 0 — Infrastructure

RDS PostgreSQL 16 + PostGIS in eu-west-1, private KMS-encrypted S3, VPC, extensions, migration tooling, conventions, repo and CI.

**Done:** Terraform for the whole stack; `postgis` / `pgvector` / `pgcrypto` / `citext` in `migrations/0001`; dbmate chosen and wired; conventions fixed in [CONVENTIONS.md](CONVENTIONS.md); CI applies every migration to a real PostGIS container, rolls the stack back, rebuilds it, and runs the verification suite.

**Outstanding:** `terraform apply` — needs AWS credentials and local tooling. See [STAGE-0.md](STAGE-0.md) for the runbook and the cost breakdown.

## Stage 1 — Spatial schema + seed existing projects

**Built** (`migrations/0003`): `organizations`, `projects`, `farms`, `plots`, `strata`, `baseline_control_sites`, `sampling_points`, with GIST indexes, SRID 4326 enforced by the column type, and constraints.

Note the deviation from the plan's table list: `farms` sits between `projects` and `plots`. The plan inherited the spec's `projects → plots`, but a Verra grouped project is an umbrella and each participating farm is a separate instance. Kisima, RAI and Casterra are farms under a grouped project, not projects in their own right — which also matches how the marketplace already presents them. See [SPEC-DELTAS.md](SPEC-DELTAS.md) §1.

**Outstanding:**
- Seed the three existing projects and their farms
- Import plot polygons from the existing GeoJSON (`ST_GeomFromGeoJSON`)
- One-way PostGIS → Mapbox sync, via the `polygons-for-mapbox` skill
- Acceptance test: point-in-plot spatial query

**Blocked on:** the GeoJSON files, and confirmation of which farms sit under which grouped project. One file is already in the workspace (`Sugarcane_TZ_Farm_FIXED.geojson`); the others I have not seen.

## Stage 2 — Permissions, tokens, audit

**Built** (`migrations/0003`, `migrations/0005`): `users`, `project_memberships`, `audit_log` (append-only, trigger-enforced), `agent_action_policies` with the spec's default AUTO/CONFIRM policy seeded.

**Outstanding:**
- `mcp_tokens` — work-order-scoped, so it lands with stage 3
- `agent_memory` with pgvector embeddings (extension is already enabled)
- RLS policies keyed on `project_id`, written and left disabled

On RLS: the plan is right that it should be laid down now even under a single tenant. The subtlety is that `farms` reaches `project_id` directly while `plots` and everything below reach it through `farms`, so the policies need a helper function rather than a column check, or every deep table pays a join per row. Worth doing once, carefully.

## Stage 3 — Sampling lifecycle

`sampling_cycles`, `work_orders`, `mcp_tokens`, `sampling_events`, `samples`. State machines as enums with transitions written to `audit_log`. Sample ID generation.

**Decide first:** the plan says 10 digits (`OFM0000000001`), the spec text agrees, and every mockup in the spec shows 8 (`OFM00021615`). The generator is a one-line change but the format ends up printed on physical sample bags and matched by the barcode scanner, so it wants to be right the first time. Flagging rather than guessing.

## Stage 4 — Lab ingestion + SOC schema

`labs`, `lab_imports`, `soc_measurements` (CropNut canonical, two depth rows per sample), `import_quarantine`, `esm_soc_stocks`, and the ingestion pipeline.

`mrv.soc_stock_t_per_ha()` already exists and implements the ×100 factor — see the README for why the spec's ×1000 is wrong. Recomputing in the service layer rather than trusting the workbook formula is exactly right, and this function is where that happens.

Buildable now against a schema-conforming dummy file; validated against the first real lab workbook when it arrives.

## Stage 5 — Credits & compliance

**Built** (`migrations/0004`): `fertilizers`, `machinery_defaults`, `ghg_parameters` — the reference layer, seeded from the GHG calculator workbook.

**Outstanding:** `products`, `alm_activities`, `credits`, `vcu_issuances`, `compliance_checks`, `compliance_scores`, the per-plot credit view, and the 8 hard checks.

The plan scopes this as the commercial branch. The GHG calculator adds a second, larger piece the plan does not mention: QA3 emissions accounting — activity data, computed baseline and project emissions, leakage. See [GHG-CALCULATOR.md](GHG-CALCULATOR.md). It belongs in this stage and roughly doubles it.

## Stage 6 — QA1 model structures

`model_runs`, `model_results`, `mvr`. Tables now, DNDC/DayCent integration deferred. This is also where a NAT gateway becomes necessary, since containerised runners need outbound internet.

## Stage 7 — Hardening

Automated backups and snapshots (partly configured in Terraform already), S3 lifecycle to Glacier (configured), spatial index tuning against the <2s / 500-point target, end-to-end data chain test, schema documentation in the repo.

---

## Open decisions

| # | Question | Blocks |
|---|---|---|
| 1 | RDS as planned, or Supabase alongside the SaaS? | Stage 0 apply — see [STAGE-0.md](STAGE-0.md) |
| 2 | Sample ID width: 8 or 10 digits | Stage 3 |
| 3 | Confirm SOC ×100 with CropNut in writing | Stage 4 |
| 4 | Does an MRV farm link to a SaaS `public.farms` row, and how? | Stage 1 seeding |
| 5 | Which farms sit under which grouped project? | Stage 1 seeding |
