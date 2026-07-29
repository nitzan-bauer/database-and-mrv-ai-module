# Stage 5 — Credits, GHG accounting and compliance

## ✅ Done — 23 July 2026

Eleven tables across three migrations (`0012`–`0014`), applied to RDS. 26 verification checks pass against the live instance, five of them new here.

The work plan scoped this stage as the commercial branch. It turned out to be three branches, because the GHG calculator carries a whole accounting layer the plan did not mention.

```
0012 commercial   products · alm_activities · credits · vcu_issuances   → v_plot_credits
0013 GHG (QA3)    activity_data · fertilizer_applications · emission_results · leakage
0014 compliance   stratum_statistics · compliance_checks · compliance_scores
```

## The commercial branch

`products` is the marketplace catalogue, seeded from the live API (`seeds/0003`): DYNOMYCO Spark WP, the Rootella family, CoteN, Multicote — each with its ex-ante `credit_per_ha`.

`credits.credits_tco2e` is a **generated** column, `application_area_ha × credit_per_ha`. The area and rate are stored, not recomputed, so a later product-price change cannot silently rewrite a credit already shown to a buyer. `v_plot_credits` rolls credits up per plot for real (non-demo) plots — the figure the marketplace's "Received Credits" reads.

The demo interlock from migration 0007 extends here: `check_demo_child_of_plot()` refuses a real credit or activity on a demo plot, and vice versa.

## The GHG accounting branch — the piece the plan missed

The GHG calculator computes the actual emission-reduction figure a project reports, from fertilizer, fuel and residue data. That is not optional decoration on the commercial branch; it is how QA3 emissions are quantified. So it is built:

- `activity_data` — one farm-year per scenario (baseline vs project), with fuel, residue burnt and N-fixing residue.
- `fertilizer_applications` — a child table, one row per product. The workbook hard-codes three synthetic fertilizer slots per row; a child table removes that ceiling. `n_applied_t` is generated, annualising organic mass by its application interval (compost applied once per 10 years contributes a tenth per year).
- `emission_results` — computed, append-only.

The engine is `mrv.compute_emissions(activity_data, parameter_set)`, one function applying the VM0042 equations (18, 21–24, 32, 6–7) against a parameter set. Kept in SQL so the calculation lives in one auditable place, the same reason the derived-parameter functions do.

It reproduces the workbook exactly. For the calculator's own Farm_A 2022 row — 50 ha, UAN 40 t, N-P-K 25 t, compost 500 t/10 yr, 9000 L diesel:

```
FSN = 14.80 t N   (UAN 0.32×40 + NPK 0.08×25)
FON =  0.75 t N   (compost 0.015×500/10, annualised)
N2O direct = 1.6836 tCO2e/ha   CO2 fuel = 0.5195   TOTAL = 2.7532 tCO2e/ha
```

The double-counting guard is built in: soil N₂O is counted in the total only when the parameter set is QA3. Under QA1 it comes from the model instead, so the function returns the components but excludes them from the total — exactly as the workbook's `IF(approach="QA3",…)` does.

`leakage` holds the VM0042 §8.4 components. §8.4.1 (organic amendments) is computable; the others are entered with justification. This is where VMD0054's heavier data obligation will land when leakage is fully built out.

## The compliance engine

`mrv.evaluate_compliance(farm, cycle)` runs VM0042 v2.2's own §8.2.1 hard checks — confirmed by the research to be the right source, since VMD0018/VMD0021 belong to the older VM0021 lineage and are not cited by VM0042 v2.2.

The hard checks:

| Rule | VM0042 |
|---|---|
| `STRATIFIED_RANDOM` | §8.2.1.2 |
| `MIN_3_COMPOSITES` — ≥3 points per stratum | §8.2.1.2 |
| ↳ *raised to* `MIN_5_COMPOSITES` *—* ≥5 *points per stratum by migration 0018* | §8.2.1.2 |
| `ESM_TWO_INCREMENTS` — 2 depth increments per sample | §8.2.1.6 |
| `QA2_3_CONTROL_SITES` — ≥3 BSL, each ≤250 km (QA2 only) | §8.3 |

Plus a soft `HIGH_CV` warning where a stratum's CV exceeds 30% (§8.2.1.3) — the flag the sampling-optimisation argument turns on.

Scoring: 100 when every hard check passes, else the fraction that passed scaled to 0-100, minus 5 per warning. **A hard failure caps the score below 100 no matter what** — the dashboard reads red, which is the point. The acceptance test confirmed it: a compliant QA2 farm-cycle scored 100; dropping a stratum to 2 points dropped it to 75 as `MIN_3_COMPOSITES` flipped to fail.

**Update (migration 0018).** §8.2.1.2 sets a floor of "at least 3–5 composite samples within each stratum". Functional Specification v2.0 takes the conservative end of that range: the floor is now **5**, enforced identically by the compliance engine (`MIN_5_COMPOSITES`) and by the sampling-plan generator, so the planner cannot propose a cycle the engine would later fail.

`stratum_statistics` holds n, mean, SD, CV and achieved MDD per stratum per cycle — computed from `soc_measurements`, append-only. It feeds both the CV warning and, later, the sampling-plan generator.

## Two bugs the process caught

**A nested procedure that PostgreSQL would reject.** The first draft declared a helper `PROCEDURE` inside the function's `DECLARE` block. `libpg_query` parses it, but plpgsql has no such construct — it would have failed at apply. Caught by reasoning about it before applying; the helper became a schema-level `mrv.record_check()`.

**A blind find-replace that corrupted the SRID.** Bumping the expected table count from 26 to 37 with a global `26→37` replace also turned every `4326` into `4337` in verify.sql — eight SRID references, silently wrong. Caught immediately on the next read and reverted. A reminder that a "count" change is never safe as a string replace.

## Outstanding for later stages

- **The credit/emission reconciliation** — the ex-ante marketplace `credit_per_ha` versus the ex-post computed reduction. That is a reporting view, stage 7.
- **ESM stock-change into net reductions** — `esm_soc_stocks` (stage 4) and `emission_results` (here) both feed the net figure; the roll-up view is stage 6/7.
- **VMD0054 leakage** — the table exists; the five-step quantification is application logic.
- **The Eq. 74 uncertainty deduction** — needs the QA1 model results (stage 6) before it can be computed end to end.
