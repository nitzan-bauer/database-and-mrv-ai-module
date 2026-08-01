# Regulatory basis — VM0042 and its modules

Research brief, 22 July 2026. Everything below was read from primary PDFs, not from summaries. Where a claim could not be verified it says so.

Documents reviewed: **VM0042 v1.0 / v2.0 / v2.1 / v2.2**, **VMD0053 v2.0 and v2.1**, **VT0014 v1.0** plus its 16 Oct 2025 corrections, **VMD0054 v1.0**, **IPCC 2006 Guidelines** Vol 1 Ch 3 and Vol 4 Ch 2/5/11, **IPCC 2019 Refinement** Vol 4 Ch 2/5/11.

---

## 1. "One sample per 10 hectares" does not exist

Checked in all four versions of VM0042 by full-text extraction and exhaustive phrase search. **No version states a sampling density.** Nothing was removed either — the Document History tables record no such addition or deletion, and the relevant text is verbatim identical from v2.0 through v2.2.

- **v1.0 §9.3.1** delegates entirely to the project's monitoring plan: sample design "will be specified in the monitoring plan", with the proponent specifying sampling intensities.
- **v2.0 / v2.1 / v2.2 §8.2.1.3** items 10 and 11 give a *variance-based* rule, not a density: samples "should be determined based on the expected variance", a pre-sampling of **5–10 per stratum** may estimate that variance, and a power analysis "may be conducted... **However, projects are not required to take this number of samples.**"

VMD0053 and VT0014 are equally silent, and VT0014 §5.2.1(5) says so explicitly: *"There is no fixed minimum number of soil samples for model calibration, recalibration, or validation."* IPCC gives no sample-count requirement in either the 2006 Guidelines or the 2019 Refinement; the 2019 text asks only for "a sufficient number of samples" and leaves "sufficient" undefined.

**Two plausible origins of the folk rule**, both misreadings:

1. A descriptive sentence inside VM0042 itself — *"Numerous factors determine SOC heterogeneity at field (10–100 ha) and landscape (100–1000 ha) scales"* — which is about spatial scales of heterogeneity, not a sampling requirement.
2. Vendor defaults. Regrow's Soil Sample Design Model documents one sample per 1.6 ha as an internal conservative default. Verra's own **draft** Soil Sampling and Analysis Handbook (Feb 2026) discusses samples-per-field only inside a worked multistage example.

**Watch item:** a VM0042 v3.0 / VMD0053 revision went to public consultation 11 Feb – 31 Mar 2026, bundled with a Soil Sampling and Analysis Handbook. Approval could not be confirmed — the Verra page still lists v2.2 as active with the revision under "Proposed Revisions". If that Handbook is adopted it is the most likely place a density rule would finally appear, and it should be re-checked before a long-horizon design is locked.

## 2. Every layer prices uncertainty rather than mandating effort

This is the single structural fact that governs the whole design. VM0042 §8.6.4 Equation 74 applies a **probability-of-exceedance deduction** — credits are issued at the 33.3rd percentile of the ERR distribution:

```
UNC%(δ,t) = ( √Var(ERR δ,t) / ERR δ,t ) × 100 × t₀.₆₆₇      t₀.₆₆₇ ≈ 0.4307
```

Undersample and the variance rises, the deduction eats the credits, and nothing fails validation. VMD0053 §5.2.4 states the incentive plainly: *"high model prediction error will be yielded in two circumstances: through low precision of an accurate model or high precision of an inaccurate model."*

Variance reaches Eq. 74 by four routes (VM0042 Figure 5):

| Path | Equations |
|---|---|
| QA1 analytical error propagation | 60–64 |
| QA1 Monte Carlo | 65–69 |
| QA2 conventional lab | 70–71 |
| QA2 proximal sensing | 70 + 72/73 |

Two subtleties worth carrying into implementation. In **Eq. 63** only the sampling term is divided by A², because model error is already on an area basis; in **Eq. 69** the model term *is* divided by A², because the Monte Carlo formulation estimates it on project totals. And model variance **must not be split across strata** — shared calibration parameters make it a project-wide quantity, unlike sampling variance which sums across strata.

Monte Carlo draws: VM0042 recommends **500–1000**. IPCC mandates no count, offering 10,000 as an illustration and two convergence tests instead; the US Tier 2 soil-carbon example in Box 3.2 used 50,000.

**QA3 asymmetry:** under default factors, model/EF prediction error is presumed **zero** (§8.6.3), and sampling error is zero where management data cover all quantification units. QA3 therefore attracts no deduction from these terms at all — worth weighing against QA1's modelled error for sources where a default factor is acceptable.

## 3. VT0014 — digital soil mapping, and where the leverage actually is

**VT0014 v1.0** (26 Aug 2025, Perennial Climate) became usable with VM0042 through the 10 Oct 2025 Corrections & Clarifications, which struck the previous outright prohibition on remote sensing. **v2.2 already contains the permitting text** in §8.2.1.4, so the C&C does not need to be read alongside it.

DSM does not replace sampling; it **reallocates what samples are for**, and the asymmetry is the point:

| | Calibration data | Validation data |
|---|---|---|
| Location | inside **or outside** project area | **project area / baseline control site only** |
| Date | **may predate project start** | must be after project start |
| Synthetic data | **permitted** (§5.1.6) | not permitted |

So the calibration set can require **zero new in-project cores**. The irreducible physical sampling is the validation set. With no minimum count, its size is driven by three practical floors: the variogram geometry (§5.5.1 requires **≥50 point-pairs per lag bin**, with inter-point distances in the **0–500 m** range adequately represented — this forces a clustered design), the 90% coverage test, and whatever VM0042's own rules still impose.

**The validation bar is startlingly low and this is deliberate.** §5.1(10) requires only: coverage ≥90% of observations inside their 90% prediction interval; goodness of fit **R² > 0**; and bias not significantly different from zero (t-test, α=0.05). No RMSE threshold, no RPD requirement. A model with R² = 0.05 passes — and then bleeds credits, because to achieve 90% coverage it must widen its prediction intervals, which flows straight into Eq. 74. **Accuracy is priced, not gated.**

**Eq. (5)** — the DSM analogue of revisiting the same points:

```
var(ΔSOC) = var(t+Δt) + var(t) − 2·ρ·√var(t+Δt)·√var(t)
```

Systematic model bias persists across time for the same locations and covariate stack, so ρ is high and the covariance term subtracts. Same mechanism as VM0042 Eq. 71, different instrument.

**Whether DSM raises or lowers the deduction is not stated in either document and could not be verified empirically.** No worked example is obtainable — VT0014 Appendices 3 and 4 are published only as HTML supplements that could not be located, and no registry project has yet applied the tool. Structurally it cuts both ways: wall-to-wall prediction removes sampling error from the dominant position, but model prediction error replaces it and does *not* decline as 1/n because of spatial autocorrelation — which is exactly why §5.1.1 mandates accounting for spatial covariance of prediction errors.

**Three cautions.**
- VT0014 v1.0 as first published had a real error: the 44/12 ratio in Eq. (7) was **unsquared**, understating removal variance by ~13.4×. Corrected 16 Oct 2025. Any vendor model built against the August 2025 text should be checked.
- No minimum spatial resolution is specified — verified *absent*, not verified permissive. Coarse products would likely fail edge exclusion and the 0–500 m variogram requirement anyway.
- **Unresolved:** VM0042's 11 Jun 2026 C&C Clarification 8 requires QA2 remeasurement with SOC "directly measured in each sample field", written in conventional-sampling terms and without reference to VT0014. How that reconciles with DSM mapped predictions is not addressed in either document. Worth putting to Verra before committing a QA2 design to DSM.

Governance overhead is real: the **VVB** contracts a Verra-approved DSM-IME, a DSM-MVR is required, code and data must be version-controlled and reproducible, and **both the MVR and the IME report are published on the registry**. For a small project this can exceed the sampling saved.

## 4. QA1 versus QA2 — what actually differs

Neither VM0042 nor VMD0053 states a sample count for either approach, or any percentage reduction for QA1. Anyone quoting "QA1 needs X% fewer samples" is not quoting the methodology. The saving is structural:

| | QA1 Measure & Model | QA2 Measure & Remeasure |
|---|---|---|
| Baseline SOC | modelled; direct measurement at t=0 as model input | physically measured **and remeasured at control sites** |
| Control sites | **none required** | **≥3 project-wide, ≥1 per stratum**, within 250 km, Table 7 similarity criteria, fixed for project life |
| Project SOC | at least every 5 years, for true-up | every 5 years **or prior to each verification**, in project *and* control sites |
| N₂O / CH₄ | **never measured in-project** | QA2 is SOC-only; these go to QA1 or QA3 regardless |
| ESM | calibration/validation datasets **exempt** | required |

QA1's saving is therefore threefold: the entire control-site programme disappears; sampling frequency decouples from verification frequency (a project verifying annually still samples once per five years); and no flux campaign is ever needed.

**The most useful provision found in this research** is §8.6.1.3 as clarified June 2026:

> "soil samples do not need to be taken from every project activity instance (i.e., field or management unit) at every remeasurement event. In consequence, the requirement to measure SOC stocks every five years or more frequently does not apply at the project activity instance-level."

You may sample fewer instances, carry the resulting sampling error into the Eq. 62/68 variance term, and pay for it in the deduction rather than in a compliance failure. That is the actual economic lever in QA1, and it is explicit.

Note also that **true-up does not require recalibration** — it requires re-running the VMD0053 validation, submitting an updated MVR for IME review, and recalculating deductions for *future* vintages. **Previously issued VCUs are not clawed back.**

## 5. VMD0053 — what a valid model costs

**Version note:** the current module is **v2.1** (active 25 Mar 2025), retitled *Model Calibration, Validation and Uncertainty Guidance for Biogeochemical Modeling for Agricultural Land Management Projects*.

Neither VM0042 nor VMD0053 names DNDC, DayCent or RothC as approved. The module is model-agnostic; validity is earned per project, per parameter set — *"every parameter set must be validated separately."*

**Two pass/fail tests.** Bias ≤ pooled measurement uncertainty (Eq. 1 and 2), and 90% prediction intervals containing the measured value for ≥90% of validation observations. Both have a petition route requiring IME approval and VVB review.

**The IME is hired by the VVB, not the proponent.** This is the most commonly misunderstood point in the module and is stated twice. The proponent supplies documentation and bears the burden of proof. All MVRs and IME assessment reports are **published on the Verra registry**.

**The validation dataset carries dimensional requirements** rather than count requirements: every declared climate zone represented; the three most predominant soil textural classes included; a span of **≥15 percentage points of clay content**; at least one study isolating each practice change. There is an anti-overfitting guardrail — parameters must be defined at a resolution no finer than one IPCC climate zone or nationally defined agricultural land region.

**One operative constraint on duration** (VM0042 §8.6.1.1.1): the validation dataset's error may only be applied to simulations no longer than the **median experiment length** in that dataset.

## 6. VMD0054 — leakage, and a real increase in burden

**New in v2.2.** Previously §8.4.3 was a light test: a once-per-decade demonstration that productivity had not declined more than 5%. VMD0054 replaces it with a full five-step quantification of activity-shifting and market leakage, assessed for five years after project start, tracing foregone production → market replacement → new land converted → carbon lost on that land.

Defaults: **IS = 0.75** (share of leakage becoming outside supply; 1.00 for fuelwood), **NL = 0.40** (share of that from new land; 1.00 for fuelwood), yield growth **r = 2.5%/yr**. New land is assumed **forested** with complete biomass loss.

VM0042 imposes four modifications: terminology (ALM for ARR); Eq. (5) replaced so the value may go **negative**, capturing land sparing from added commodities; Eq. (7) replaced with `max(Σ, 0)` so net land sparing cannot generate positive leakage; and conversion from cumulative to annual via Eq. (36).

**Implication for the data model:** leakage needs per-commodity historical production for a reference period (greater of 3 years pre-start or one full rotation), monitored project-area production for ≥5 years, and a documented evidence hierarchy for the historical figures. That is a data-collection obligation the current schema does not yet carry.

## 7. IPCC — what Verra actually inherits

**No sample-count requirement.** Neither the 2006 Guidelines nor the 2019 Refinement specifies a minimum sample number, minimum detectable change, or required statistical power for soil carbon. IPCC delegates it to the compiler's uncertainty analysis. Any such requirement in VM0042 is Verra's own — and as established above, VM0042 doesn't impose one either.

The 2019 Refinement does corroborate the interval lever: re-sample *"every 3 to 5 years or each decade; shorter sampling frequencies are not likely to produce significant differences due to small annual changes in C stocks relative to the large total amount of C in a soil."* It also notes that stock-difference estimation is impossible until **two measurement cycles** have completed.

**Error propagation** (2006 Vol 1 Ch 3), the basis for VM0042's Eqs. 60–64:

```
multiplication:        U_total = √(U₁² + U₂² + … )
addition/subtraction:  U_total = √( (U₁x₁)² + (U₂x₂)² + … ) / (x₁ + x₂ + … )
```

The first is inapplicable to division; the second is *exact* for uncorrelated variables. Both assume CV < ~0.3. **Above CV 0.3, Approach 1 degrades and Monte Carlo is preferred** — and since SOC change routinely exceeds CV 1.0, this is the technical reason VM0042 offers the Monte Carlo path at all.

**Emission factors** — the 2019 values in `migrations/0004` are confirmed correct: EF1 wet synthetic **0.016**, dry **0.005**, Frac_GASF **0.11**, Frac_GASM **0.21**, EF4 **0.014** wet, Frac_LEACH **0.24**, EF5 **0.011**.

Two things worth knowing about them. **Frac_LEACH is zero in dry climates** unless irrigation puts water past the root zone — flood, furrow or sprinkler, but not drip — and the Tier 2 threshold is stricter than "precipitation exceeds evapotranspiration": it is (rain − ET₀) > soil water holding capacity. And **EF5 rose ~47%** from 2006 (0.0075 → 0.011), while **EF1 for dry climates has no organic/synthetic split** — 0.005 covers both.

The irrigation method sits on the farm (`mrv.farms.irrigation_method`), not on the parameter set, because a grouped project spans farms that irrigate differently and nothing about it follows from the country. In a wet zone the method does not change Frac_LEACH at all — the surplus is rainfall — but it is still recorded, since VM0042 counts a move to improved irrigation as an eligible project activity.

**A trap for the SOC side:** the 2019 Refinement roughly **halves** the credited SOC benefit of no-till (F_MG tropical moist 1.22 → 1.10) and sharply raises tropical long-term-cultivation F_LU (0.48 → 0.83). The 2006 and 2019 climate strata were re-cut and are **not one-to-one comparable**. Which vintage a project invokes materially changes crediting, and the mapping of VM0042's cross-references to 2006 versus 2019 was not verified in this research.

---

## Open questions worth putting to Verra or a VVB

1. Has VM0042 v3.0 / the revised VMD0053 been approved, and does the Soil Sampling and Analysis Handbook introduce a sampling density?
2. How does VT0014 DSM reconcile with the June 2026 requirement that QA2 SOC be "directly measured in each sample field"?
3. What rubric does a DSM-IME use to judge validation-set sufficiency? There is no published standard, so sample-count risk under VT0014 is IME-discretion risk.
4. Which IPCC vintage (2006 or 2019) applies to each stock-change factor VM0042 references?
