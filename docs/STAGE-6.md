# Stage 6 — QA1 model structures

## ✅ Done — 23 July 2026

Three tables (migration `0015`), applied to RDS. 28 verification checks pass, three new here. As the plan intended: the schema is ready to receive DNDC/DayCent output, the model integration itself deferred.

```
model_runs      one DNDC / DayCent run — config, status, provenance
model_results   per-stratum delta-SOC + the uncertainty terms
mvr             VMD0053 Model Validation Report + IME signoff
```

## Shaped by the regulatory research, not guessed

This stage is where the VMD0053 and Eq. 74 findings land in the schema.

**`model_runs`** carries `uncertainty_method` (`analytical` | `monte_carlo`) and `monte_carlo_iters`, with a constraint that iterations only mean something on a Monte Carlo run. VM0042 recommends 500–1000 iterations; the column holds whatever the run used, and `input_manifest` snapshots every input source so a run is reproducible — VMD0053's requirement that a stochastic model disclose its seeds and version.

`cycle_id` is nullable on purpose: a baseline-initialisation or a recalibration run is not tied to one sampling cycle, only a true-up or verification run is.

**`model_results`** stores the two delta-SOC scenarios and generates `net_t_ha` as project minus baseline, so the net can never drift from its parts. Alongside it: `var_model`, `var_sampling` and `uncertainty_pct` — the variance components and the Eq. 74 deduction. The research established why both variances are stored separately: under the analytical path (Eqs. 60–64) only the sampling term is divided by area; under Monte Carlo (Eqs. 65–69) the model term is too. Keeping the components means Eq. 74 is computed from stored numbers, not re-derived at report time. Append-only, so a reported vintage stays reproducible.

**`mvr`** records the VMD0053 v2.1 validation chain, and two of its columns exist specifically because the research flagged them as the most-misunderstood parts of the module:

- `ime_contracted_by` **defaults to `VVB`**. The IME is hired by the VVB, not the proponent — stated twice in VMD0053 and the single point practitioners get wrong. The default encodes it.
- `ime_report_url` and `registry_url` are separate columns because **both the MVR and the IME assessment report are published on the Verra registry**. The schema expects them to become public.

The validation outcomes are stored explicitly — `mean_bias` against `pooled_meas_unc` with a `bias_within_pmu` flag, and `coverage_pct` with `coverage_pass` — because a VVB reads those two tests (bias ≤ PMU, and ≥90% of observations inside their 90% prediction interval) directly rather than re-deriving them.

## Acceptance test

Against the live database:

```
DNDC run created (Monte Carlo, 1000 iters)
result: WP 1.40 - BSL 0.20 -> net = 1.2000 t C/ha (generated); Eq.74 deduction 12.5%
monte_carlo_iters on an analytical run rejected: yes
MVR: IME contracted by VVB | bias<=PMU true | 90% coverage true
model_results rejects UPDATE: yes
non-demo run on a demo farm rejected: yes
```

## What is deliberately not here

**The models themselves.** DNDC and DayCent are containerised CLI binaries; running them is application/infrastructure work, and it is the point at which a NAT gateway becomes necessary (a private-subnet task pulling a container image needs outbound internet). That is stage 7 infrastructure plus application code, not schema.

**The Eq. 74 computation.** The columns to hold its inputs and output exist. The function that walks Eqs. 60–74 belongs in the service layer, next to `compute_emissions()` — or in SQL if it stays tractable. Deferred until there is a real model run to compute against.

**Digital soil mapping (VT0014).** Its own tool, its own tables if adopted — covariate sources, validation sets, variograms. Out of scope for the plan's stage 6, and a live open question (its interaction with the June 2026 QA2 clarification is unresolved, per REGULATORY-BASIS.md §3).
