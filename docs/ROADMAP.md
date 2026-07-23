# Roadmap

Stage numbering follows the work plan of record (July 2026). The database is finished before AI-MRV module development starts.

An earlier draft of this file used an A/B/C lettering; that is superseded. What it called "Stage A" is now spread across stages 1, 2 and part of 5 below.

| Stage | Scope | Status |
|---|---|---|
| **0** | Infrastructure | ✅ Provisioned and verified — [STAGE-0](STAGE-0.md) |
| **1** | Spatial schema + seeding the demo farms | ✅ Done — [STAGE-1](STAGE-1.md) |
| **2** | Permissions, tokens, audit | ✅ Done — [STAGE-2](STAGE-2.md) |
| **3** | Sampling lifecycle | ✅ Done — [STAGE-3](STAGE-3.md) |
| **4** | Lab ingestion + SOC schema | ✅ Done — [STAGE-4](STAGE-4.md) |
| **5** | Credits & compliance | ✅ Done — [STAGE-5](STAGE-5.md) |
| **6** | QA1 model structures | ✅ Done — [STAGE-6](STAGE-6.md) |
| **7** | Hardening, backups, audit-readiness | ✅ Done — [STAGE-7](STAGE-7.md) |

---

## Stage 0 — Infrastructure

RDS PostgreSQL 16 + PostGIS in eu-west-1, private KMS-encrypted S3, VPC, extensions, migration tooling, conventions, repo and CI.

✅ **Complete.** Provisioned in `eu-west-1`, account 151498473514: RDS PostgreSQL 16.13, PostGIS 3.4.6, pgvector 0.8.1, three KMS-encrypted S3 buckets, VPC. dbmate chosen over Alembic; conventions fixed in [CONVENTIONS.md](CONVENTIONS.md); CI applies every migration to a real PostGIS container, unwinds the whole stack, rebuilds, and runs 16 assertions.

Billing runs on AWS Free-plan credits — the card is not charged. Credits expire 2027-01-21. Details and the two Free-plan constraints in [STAGE-0.md](STAGE-0.md).

## Stage 1 — Spatial schema + seed existing projects

**Built** (`migrations/0003`): `organizations`, `projects`, `farms`, `plots`, `strata`, `baseline_control_sites`, `sampling_points`, with GIST indexes, SRID 4326 enforced by the column type, and constraints.

Note the deviation from the plan's table list: `farms` sits between `projects` and `plots`. The plan inherited the spec's `projects → plots`, but a Verra grouped project is an umbrella and each participating farm is a separate instance. The demo farms are farms under a grouped project, not projects in their own right — which also matches how the marketplace already presents them. See [SPEC-DELTAS.md](SPEC-DELTAS.md) §1.

✅ **Complete.** Seeded with the two demo farms — Elad Farm (Kenya, 2 plots) and Nitzan-Veg-Tech Farm (Israel, 5 plots) — under grouped project `CARBO-3988-DEMO`. Kisima, RAI and Casterra were also demos and were dropped.

Polygons came from the live SaaS API rather than a file, so the geometry matches what the marketplace renders. Migration 0007 adds the `is_demo` interlock. Acceptance test passes: all 7 plots resolve uniquely under point-in-plot. Detail in [STAGE-1.md](STAGE-1.md).

**Still outstanding:** the one-way PostGIS → Mapbox sync, deliberately deferred — today the flow runs the other way, and a second writer would create two sources of truth for the same polygons. See open decision 4.

## Stage 2 — Permissions, tokens, audit

✅ **Complete**, with one deliberate deferral.

`users`, `project_memberships`, `audit_log`, `agent_action_policies`, `agent_memory` (pgvector + HNSW), 11 RLS policies written and inert, and — the part that was nearly missed — audit logging that actually happens. `audit_log` held 2 rows from my own probes until migration 0008 put triggers on 12 core tables, so a change is recorded whoever makes it and however. Detail in [STAGE-2.md](STAGE-2.md).

`mcp_tokens` moved to stage 3: a token is scoped to a work order, and `work_orders` does not exist yet.

## Stage 3 — Sampling lifecycle

`sampling_cycles`, `work_orders`, `mcp_tokens`, `sampling_events`, `samples`. State machines as enums with transitions written to `audit_log`. Sample ID generation.

**Settled 21 July 2026: 10 digits.** `OFM` + 10 zero-padded digits, e.g. `OFM0000021615`, giving a 13-character identifier.

The spec's mockups show 8 digits (`OFM00021615`); the spec text, the work plan and Nitzan all say 10. Ten it is — the mockups are illustrative, and the format ends up printed on physical sample bags and matched by a barcode scanner, so widening it later would mean two incompatible ID formats in the same project.

`mrv.next_sample_id()` in migration 0002 currently pads to 8 and must be changed to 10 when stage 3 lands. No sample rows exist yet, so this costs nothing now and would be painful after the first campaign.

## Stage 4 — Lab ingestion + SOC schema

`labs`, `lab_imports`, `soc_measurements` (CropNut canonical, two depth rows per sample), `import_quarantine`, `esm_soc_stocks`, and the ingestion pipeline.

`mrv.soc_stock_t_per_ha()` already exists and implements the ×100 factor — see the README for why the spec's ×1000 is wrong. Recomputing in the service layer rather than trusting the workbook formula is exactly right, and this function is where that happens.

Buildable now against a schema-conforming dummy file; validated against the first real lab workbook when it arrives.

## Stage 5 — Credits & compliance

✅ **Complete** — three branches, not one. Migrations `0012`–`0014`, detail in [STAGE-5.md](STAGE-5.md).

- **Commercial** (`0012`): `products` (seeded from the marketplace API), `alm_activities`, `credits` (generated `credits_tco2e`), `vcu_issuances`, and the `v_plot_credits` rollup.
- **QA3 emissions accounting** (`0013`) — the piece the plan did not mention: `activity_data`, `fertilizer_applications`, `emission_results`, `leakage`, and `mrv.compute_emissions()`, which reproduces the GHG calculator's Farm_A 2022 exactly (FSN 14.8 t N). Reference layer (`fertilizers`, `machinery_defaults`, `ghg_parameters`) was already built in `0004`.
- **Compliance** (`0014`): `stratum_statistics`, `compliance_checks`, `compliance_scores`, and `mrv.evaluate_compliance()` running VM0042 v2.2's own §8.2.1 hard checks. The research confirmed VMD0018/VMD0021 belong to the older VM0021 lineage and are not used here.

## Stage 6 — QA1 model structures

✅ **Complete** — `model_runs`, `model_results`, `mvr` (migration 0015). Detail in [STAGE-6.md](STAGE-6.md). The schema is ready to receive DNDC/DayCent output; the model integration and the Eq. 74 computation are deferred to application/infrastructure work in the AI-MRV module. A NAT gateway becomes necessary when the containerised runners land.

## Stage 7 — Hardening

✅ **Complete** (migration 0016 + monitoring.tf). Detail in [STAGE-7.md](STAGE-7.md). Audit-readiness views (v_sample_chain, v_data_completeness), the audit_trail() function, a retention-policy declaration, and ANALYZE on the spatial tables. Infrastructure: RDS backups/PITR/deletion-protection and S3 lifecycle were already in place from stage 0; stage 7 adds CloudWatch alarms on estimated charges (the Free-plan credit cliff) and low RDS storage.

---

## Open decisions

| # | Question | Blocks |
|---|---|---|
| ~~1~~ | ~~RDS or Supabase~~ — **settled: RDS**, provisioned 21 Jul 2026 | — |
| ~~2~~ | ~~Sample ID width~~ — **settled: 10 digits** (21 Jul 2026) | ~~Stage 3~~ |
| ~~3~~ | ~~Confirm SOC ×100~~ — **confirmed**: the CropNut datasheet formula is ×100 | — |
| 4 | Which system owns plot geometry — this database or the SaaS? Decides the Mapbox sync direction. `saas_farm_id`/`saas_plot_id` already link the two. | Mapbox sync |
| ~~5~~ | ~~Which farms under which grouped project~~ — **settled**: both demo farms under `CARBO-3988-DEMO` | — |
