# Stage 3 — Sampling lifecycle

## ✅ Done — 22 July 2026

Five tables carrying a campaign from plan to physical bag:

```
sampling_cycles          the plan for one farm's campaign
  └── work_orders          what a contractor is asked to do
        ├── mcp_tokens       work-order-scoped field access
        └── sampling_events  one capture of one point
              └── samples    the physical bag
```

Applied to RDS as migrations `0009` and `0010`. 20 verification checks pass against the live instance.

## What the research changed

Two decisions from the VM0042 work landed directly in the schema.

**Sample ID is `OFM` + 10 digits** — `OFM0000021615`, 13 characters. The spec's mockups show 8; its text, the work plan and Nitzan all say 10. A `CHECK (sample_id ~ '^OFM[0-9]{10}$')` on the table means a hand-written insert cannot introduce a second format, which matters because this number is printed on bags and matched by a barcode scanner.

**Texture is a separate sample, not an extra measurement.** `sample_type` is an enum of `soc | texture | bulk_density`, so one sampling event yields several bags. Cycle 1 sets `collect_texture` by trigger — it cannot be forgotten — and a texture sample inserted against a cycle that did not ask for one is rejected.

This is not a methodology deviation. VM0042 §8.2.1.3(10) describes exactly this campaign: *"A pre-sampling of 5 to 10 soil samples per stratum may provide an estimate of SOC variance where up-to-date soil data are unavailable."*

## Texture depth: a point, not an interval

The texture sub-sample is taken from the middle of the core cross-section at 15 cm. The first draft of the schema rejected it, because `sample_depth_chk` required `depth_base > depth_top` and a spot sample has no thickness.

The acceptance test caught this. Rather than patch it, migration 0009 was rolled back and amended — it had not been pushed — so the constraint now reads:

- `depth_base_cm >= depth_top_cm` for all samples
- `depth_base_cm > depth_top_cm` **unless** the type is `texture`

So `(15, 15)` is a legal texture sample and an illegal SOC sample. An SOC sample with no thickness cannot yield a stock, and the database now says so.

## Strata become a derived object

Migration 0010 gives `strata` a provenance: `method` (`texture | soil_map | yield_map | manual | provisional`), `derived_from_cycle`, `derived_at`, and the mean sand/silt/clay that justified the boundary.

A stratum declaring `method = 'texture'` **must** name the cycle that derived it and carry all three fractions. A VVB will ask where a boundary came from; the schema now refuses to hold a stratum that cannot answer.

Default is `provisional` — meaning cycle 1 has not run and the stratum is a placeholder, not a finding.

## USDA classification, verified by tiling

`mrv.usda_texture_class(sand, silt, clay)` returns one of the 12 USDA classes, and a trigger keeps `strata.usda_texture_class` consistent with the stored percentages so the two cannot drift.

The boundary rules could not be sourced cleanly from the web — NRCS, UGA and Purdue all describe the triangle without defining it. They were verified a stronger way instead: across **5,151 grid points covering the entire simplex, every composition matches exactly one class** — no gaps, no overlaps, all 12 classes present. Wrong boundaries would leave a hole or a double match. This runs as an assertion in `verify.sql` on every verification, not just once.

## State machines

Illegal transitions raise rather than log:

```
cycle:       draft → approved → in_field → lab_pending → complete
                 ↘ cancelled (from any non-terminal state)
work order:  draft → sent → in_progress → completed → closed
```

Both write every transition to `audit_log` through the stage 2 triggers.

Two structural guards alongside them: a work order that has left `draft` must record who issued it and when; and a cycle that has left `draft` must name its approver.

## MCP tokens — arrived from stage 2

Deferred out of stage 2 because a token is scoped to a work order and `work_orders` did not exist. Only the hash is stored; a token readable from the database is one an auditor cannot trust, and this one grants field write access.

A partial unique index enforces **one live token per work order** while allowing revoked ones to accumulate as history.

## Acceptance test

The plan's criterion was plan → work order → sampling events → samples with valid identifiers. Run against the live database:

```
cycle 1: collect_texture=true, texture depth 15 cm
draft → complete blocked
second live token blocked
  SOC 0-15    OFM0000000001
  SOC 15-30   OFM0000000002
  TEXTURE @15 OFM0000000003   (13 chars)
  zero-thickness SOC blocked
locked event frozen
20/20/60 → clay    40/40/20 → loam    10/85/5 → silt
stratum A: method=texture, class auto-derived = clay loam
texture stratum without provenance blocked
```

All test data was removed afterwards; the database holds 2 farms and 7 plots, as before.

## Outstanding

- **`work_orders.lab_id`** is an unconstrained `uuid` — the foreign key to `mrv.labs` lands in stage 4 with the lab tables.
- **Sampling plan generation** — stratified random point allocation and the power analysis are application logic, not schema. The schema holds the inputs (`confidence_alpha`, `power_1_minus_beta`, `mdd_target`) and the outputs (`sampling_points`).
- **`stratum_statistics`** — per-stratum mean, SD, CV and achieved MDD. Deferred to stage 4, where SOC measurements make it computable.
- Append-only triggers on the stage 4 evidentiary tables follow the pattern established here on `samples`.
