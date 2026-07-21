# Roadmap — database, then module

Two phases. The database is finished before module development starts.

---

## Phase 1 · Database

### Stage A — Foundation ✅ built

| Migration | Contents |
|---|---|
| `0001_foundation` | `mrv` schema, PostGIS/pgcrypto/citext, `set_updated_at()`, `prevent_mutation()`, `area_ha()` |
| `0002_enums` | All 23 enum types, including those Stages B and C will use |
| `0003_core_hierarchy` | `organizations`, `users`, `projects`, `farms`, `plots`, `strata`, `baseline_control_sites`, `sampling_points`, `project_memberships` + GIST indexes + `updated_at` triggers |
| `0004_reference_data` | `fertilizers`, `machinery_defaults`, `ghg_parameters` + the derived-parameter functions and `soc_stock_t_per_ha()` |
| `0005_audit` | `audit_log` (append-only), `agent_action_policies` |

11 tables. Reference data seeded from the calculator workbook.

**Constraints that encode methodology rather than taste:**

- `bsl_distance_chk` — a baseline control site beyond 250 km is rejected outright (VM0042 §8.2.1.2 Table 7), not flagged.
- `point_parent_chk` — a sampling point belongs to a WP plot or a BSL site, never both and never neither.
- `application_area_within_plot_chk` — treated area cannot exceed plot area.
- `idx_ghg_params_one_active` — at most one active parameter set per project.
- `ghg_parameters` is append-only: changing an emission factor means a new version, so a re-run of a past monitoring period reproduces what was reported at the time.

### Stage B — Sampling lifecycle (next)

`sampling_cycles`, `work_orders`, `mcp_tokens`, `sampling_events`, `samples`, `labs`, `lab_imports`, `soc_measurements`, `import_quarantine`, `esm_soc_stocks`.

Carries the append-only guard onto the evidentiary tables (`samples`, `soc_measurements`, `lab_imports`, `import_quarantine`) and the lock-on-submit behaviour for `sampling_events`.

Open questions to settle first:

1. **Sample ID width** — spec §11 says 10 digits, the mockups show 8 (`OFM00021615`). Affects the `next_sample_id()` generator.
2. **Composite handling** — does one bag map to one `sample_id` with the core count recorded, or do individual cores get their own rows? Affects the `samples` ↔ `sampling_events` cardinality.
3. **Depth increments** — the schema currently assumes 0-15 / 15-30 cm as a fixed pair. If a project ever needs a third increment, `depth_cm` should become a range rather than a checked value.

### Stage C — Modelling, GHG accounting & credits

Two lineages that meet only at the plot:

- **Verification** — `model_runs`, `model_results`, `mvr` (QA1 via DNDC/DayCent).
- **Quantification** — the calculator's own model: per-farm-year activity data (fertilizer applications, fuel, residue burning, N-fixing residue), computed baseline and project emissions, leakage, net reductions.
- **Commercial** — `alm_activities`, `products`, `credits`, `vcu_issuances`.

Plus the compliance rule engine: 8 hard checks and the soft warnings, scored 0-100.

The GHG side is the piece the imported v1 DDL never had. [docs/GHG-CALCULATOR.md](GHG-CALCULATOR.md) has the intended table shapes.

---

## Phase 2 · AI-MRV module

Begins only once the database is complete. The functional spec's own three-tier backlog (P1/P2/P3) governs the build order; [docs/SPEC-DELTAS.md](SPEC-DELTAS.md) lists what has changed since it was written and must be re-decided first.

Broadly: P1 is the manual end-to-end flow (map, plot details, sampling plan generator, work order, MCP sampler view, Excel ingestion, roles, audit log). P2 adds the agent and the model run console. P3 is optimisation — Monte Carlo, recalibration, MVR generation.

---

## Decisions still open

Deliberately unresolved — flagged for a working session, not guessed at:

| # | Question | Blocks |
|---|---|---|
| 1 | Does this stay a standalone database, or merge into the Supabase project as the `mrv` schema? | Deployment, not schema design — the schema works either way |
| 2 | Is the stack still AWS (RDS/S3/Lambda/Fargate, per spec §4), or Supabase + Vercel as the SaaS already runs? | Storage columns, ingestion pipeline, model runners |
| 3 | Sample ID width — 8 or 10 digits | Stage B |
| 4 | Confirm the SOC ×100 factor with CropNut in writing | First real lab import |
| 5 | Does the module's `farms` become the same row as the SaaS's `public.farms`, or stay linked by a bridge column? | Onboarding flow |
