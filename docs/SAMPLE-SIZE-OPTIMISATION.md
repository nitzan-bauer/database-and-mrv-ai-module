# Minimising sample count under VM0042 v2.2

Research note. Everything here is traced to VM0042 v2.2 section and equation numbers, from the methodology text in `docs/source/`.

The question: what is the smallest number of soil samples that remains fully compliant?

The short answer is that **VM0042 does not set a sample count, so there is nothing to comply *with* on that axis.** It sets a floor of 3–5 composites per stratum and then penalises uncertainty. The optimisation is therefore economic, not statistical: sample until the marginal cost of one more sample equals the marginal value of the credits it saves from the deduction.

---

## 1. The formula that actually governs

Not the FAO power analysis. §8.2.1.3(11) offers Equations (1) and (2) for a minimum detectable difference and then says plainly:

> "However, projects are not required to take this number of samples."

What binds is **Equation (74)**, the uncertainty deduction:

```
UNC%  =  t₀.₆₆₇ × √Var(ERR) / ERR × 100 × 0.667
```

with `t₀.₆₆₇ ≈ 0.4307` at large n. Collapsing the constants:

```
UNC%  ≈  28.73 × CV_change / √n
```

and solving for the sample count:

```
n  =  ( 28.73 × CV_change / UNC_target )²
```

`CV_change` is the coefficient of variation **of the SOC stock change**, not of the stock. That distinction is the whole problem: the change is a small difference between two large, noisy numbers, so its CV is often several hundred percent where the stock's CV is 20–40%.

## 2. Where the variance comes from — and the one term that matters

**Equation (71)**, per stratum:

```
σ²_change  =  σ²_final  +  σ²_start  −  2·Cov(final, start)
```

The covariance is *subtracted*. Revisiting the same georeferenced points makes the two visits highly correlated, and the variance collapses:

```
σ²_change = 2σ²(1 − r)
```

| correlation r | sd of change | n for a 10% deduction |
|---|---|---|
| 0.00 (fresh points) | 16.97 | 2377 |
| 0.50 | 12.00 | 1189 |
| 0.70 | 9.30 | 714 |
| **0.90** | **5.37** | **238** |
| 0.95 | 3.79 | 119 |

*(sd of stock 12 t/ha, signal 1 t CO₂e/ha/yr)*

Going from fresh points to revisited points at r = 0.9 cuts the required count by a factor of **ten**. §8.6.3 states the assumption explicitly — "the same set of sample points are visited at both time points" — so this is the design the methodology already expects. It is the single largest lever and it is free.

**Equation (70)** then area-weights the strata:  `σ²_total = (1/A²) · Σ_h σ²_h`, with project and baseline variances added and their covariance conservatively excluded.

## 3. The four levers, in order of power

**1. Paired resampling** — 10× reduction, as above. Non-negotiable in the design.

**2. Sampling interval** — the strongest remaining lever, and counter-intuitive: the signal accumulates while the noise does not.

| interval | signal | CV | deduction at n=19 |
|---|---|---|---|
| 1 yr | 1 t | 537% | 35.7% |
| 3 yr | 3 t | 179% | 11.9% |
| **5 yr** | **5 t** | **107%** | **7.1%** |

**Sampling less often is cheaper than sampling more densely.** §8.3 caps this at five years — "SOC stocks must be directly remeasured every five years" — so five is both the optimum and the limit.

**3. Stratification** — texture-based strata typically cut within-stratum sd by 20–40%, which moves n from 19 to about 15 and the deduction from 7.1% to 5.5%. Real, but an order of magnitude smaller than the first two levers.

**4. Accepting a larger deduction** — the economic trade, below.

## 4. The economic optimum

Minimising `sampling cost + value of credits lost`:

```
total(n)  =  c·n  +  P · ERR · A · UNC%(n)/100

n*  =  ( P · A · K · σ_change / (200 · c) ) ^ (2/3)        K = 28.73
```

**ERR cancels out.** The optimal sample count does not depend on how large the carbon gain is — only on the absolute noise, the area, the credit price and the cost per sample. A better-performing farm does not need more samples; it simply loses less to the deduction.

Worked example — 250 ha, $50/credit, $120/sample, sd 12 t/ha, r = 0.9, 5-year interval:

```
n* = 19    →  1 sample per 13.4 ha    →  deduction 7.1%
```

| n | total cost | deduction |
|---|---|---|
| 10 | $7,294 | 48.8% |
| **19** | **$6,701** | **7.1%** |
| 40 | $7,847 | 24.4% |
| 60 | $9,688 | 19.9% |

The curve is flat near the optimum — anywhere from 15 to 25 samples costs within 2% of the minimum — so this does not need to be tuned precisely. It needs to be in the right order of magnitude.

## 5. On "one sample per 10 hectares"

**I could not find this rule in VM0042 v2.2.** It is not in the text. What the methodology actually states is a floor of "at least 3–5 composite samples within each stratum" (§8.2.1.2) for model true-up or QA2, and no ceiling.

The intuition is nonetheless well-founded: the economic optimum above lands at 1 per 13.4 ha, and moves between roughly 1 per 10 and 1 per 20 ha across plausible parameters. If the figure came from another source — VMD0053, a VVB, or the FAO/World Bank guidance VM0042 cites — it is worth locating, because a *rule* and a *coincidence* have different standing in an audit.

## 6. Two savings sitting in the text

**Composite the depth increments for SOC analysis.** §8.2.1.3(7e):

> "only the soil mass is required from the two separate depth increments. SOC content analysis may be performed on only one sample after mixing the two depth increments."

Bulk density must be measured on both increments; the SOC analysis can be run once on the mixture. That halves the most expensive line item without any methodology deviation.

**Pre-sampling is explicitly sanctioned.** §8.2.1.3(10):

> "The number of samples to be taken within each stratum should be determined based on the expected variance... A pre-sampling of 5 to 10 soil samples per stratum may provide an estimate of SOC variance where up-to-date soil data are unavailable."

This is the methodology's own justification for a cycle-1 characterisation campaign — exactly the texture-driven stratification design. It is not a deviation; it is what §8.2.1.3(10) describes.

## 7. A tension worth naming

The instinct is to enlarge strata to reduce sample count. §8.2.1.2 says the opposite:

> "The number of homogeneous sites (i.e., the number of strata) and soil composite samples should be maximized."

and

> "The larger a stratum's area and the greater the expected or known variability within a stratum, the higher the number of samples that must be taken within the stratum."

Both are right, because they act on different terms. More strata means lower within-stratum variance, which lowers n per stratum — but each stratum carries a floor of 3. So:

```
n_total  =  max( economic optimum ,  3 × number of strata )
```

For a 250 ha farm the floor starts binding at about **6 strata**. Below that the economic optimum governs and extra strata are free; above it, each new stratum costs 3 samples. **Four to six texture-based strata per farm is the sweet spot** — enough to capture real texture variation, not so many that the floor drives the count.

## 8. Not yet researched

This note covers VM0042 v2.2 itself, which is where Equations 70, 71 and 74 live, so the sampling-design question is answered from the primary source. Still outstanding:

- **VMD0053** — model calibration, validation and uncertainty. Governs the QA1 path and the MVR. Affects the deduction when modelling rather than remeasuring.
- **VT0014**, **VMD0054** — referenced tools.
- **IPCC 2019 Refinement** — Verra defers to it for emission factors, already partly captured in `GHG-CALCULATOR.md`. Its uncertainty guidance (Vol 1 Ch 3) is the source of the error-propagation approach behind Equations 60–69.
- The FAO (2019, 2020) and World Bank (2021) sampling annexes VM0042 cites as the detailed how-to for stratified random sampling.
