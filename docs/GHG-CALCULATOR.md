# The GHG calculator, as a database

Notes from reading `GHG_Calculator_VM0042_v2.2_OpenField_v1.xlsx` — what it computes, what Stage A already absorbed, and what Stage C still needs to build.

The workbook is a complete, working ERR quantification engine for **VM0042 v2.2, open-field crops, Quantification Approach 3** (default emission factors), with a hybrid QA1 path for soil carbon. It is the specification for the accounting half of this database; the functional spec covers the sampling half and barely touches emissions.

---

## What it does

Per **farm-year** (its "quantification unit"), from activity data — fertilizer invoices, fuel litres, residue burnt, N-fixing residue — it computes:

- CO₂ from fossil fuel
- N₂O from fertilizer, direct and indirect (volatilisation + leaching)
- N₂O from N-fixing crop residue
- N₂O from residue burning

Baseline is the **average of the three years preceding project start**. Reductions are baseline minus project, per hectare, applied to project area. SOC removals come separately from the QA1 model, after an uncertainty deduction. The final sheet rolls everything up into estimated VCUs, net of buffer withholding.

## Sheet map

| Sheet | Role | Landed in |
|---|---|---|
| Cover, README, Index, Equations | Documentation, traceability map, variable glossary | Read into these notes |
| Fixed Parameters | Emission factors, GWP, climate/conservativeness switches | `mrv.ghg_parameters` (Stage A) |
| Fertilizer Library | N content per product, looked up by exact name | `mrv.fertilizers` (Stage A) |
| Machinery-Diesel | HP × hours → diesel litres when invoices are missing | `mrv.machinery_defaults` (Stage A) |
| Baseline Inputs / Project Inputs | Activity data, one row per farm-year | Stage C — `mrv.activity_data` |
| Baseline Emissions / Project Emissions | Per-row computed emissions | Stage C — `mrv.emissions` |
| Net Reductions | Baseline − project, per farm | Stage C — view or materialised table |
| SOC Removals (QA1) | Model outputs + uncertainty deduction | Stage C — joins `model_results` |
| Leakage | §8.4.1 computed; 8.4.2/3/4 entered with justification | Stage C — `mrv.leakage` |
| Project Summary (VVB) | Project-wide roll-up to estimated VCUs | Stage C — view |

---

## The equations

Straight from the Equations sheet, with the VM0042 numbering. These are what Stage C must implement in the service layer (or as generated columns).

```
eq 7    EFF        = FFC(litres) × EF_CO2,fuel
eq 6    CO2_ff     = Σ EFF / area

eq 19   FSN        = Σ (mass_synthetic × N_content)
eq 20   FON        = Σ (mass_organic / interval_years × N_content)

eq 18   N2O_direct = (FSN + FON) × EF_N_direct × 44/28 × GWP / area
eq 22   N2O_volat  = [(FSN × Frac_GASF) + (FON × Frac_GASM)] × EF_N_volat × 44/28 × GWP
eq 23   N2O_leach  = (FSN + FON) × Frac_LEACH × EF_N_leach × 44/28 × GWP
eq 21   N2O_indirect = (N2O_volat + N2O_leach) / area
eq 17   N2O_fert   = N2O_direct + N2O_indirect

eq 25   F_CR       = Σ (dry_matter × N_fraction)
eq 24   N2O_Nfix   = F_CR × EF_N_direct × 44/28 × GWP / area

eq 32   N2O_burn   = GWP × mass_burnt_kg × Cf × EF_c_N2O / 1e6 / area

eq 4/5  SOC stock  = 100 × BD × depth × SOC%
eq 40   Removals   = MAX(0, ΔCO2_wp) − MAX(0, ΔCO2_bsl)
eq 38/41 Net       = (ER − leakage_ER) + (removals − leakage_removals)
        VCUs       = net − buffer × removals − other deductions
```

Two details that are easy to get wrong: the **volatilisation and leaching terms are absolute tonnes**, divided by area only when combined into the per-hectare indirect figure; and **organic N is annualised** by its application interval, so 500 t of compost applied once every 10 years contributes 50 t/yr.

---

## The three switches that change the answer

The workbook's `Fixed Parameters` sheet has four context cells that silently reshape the whole calculation. Stage A moved all four into `mrv.ghg_parameters` columns, and the two derived values into functions so the logic exists in exactly one place.

One of the four has since moved again. The workbook holds a single irrigation cell for the whole calculation, which is only workable when a workbook covers one farm. Across a grouped project it forces every farm sharing a parameter set to share an irrigation method, so migration 0022 moved it to `mrv.farms.irrigation_method` — one value per farm, no default. **Where the module and the workbook disagree on this, the module is right.**

**Climate zone → EF_N_direct** (`mrv.ef_n_direct()`)

Dry climate takes 0.005 outright. Wet climate then applies the VM0042 §8.3 conservativeness rule based on the project's nitrogen trend: decreasing N takes the low end (0.013), increasing N the high end (0.019), flat the midpoint (0.016). Using a lower factor when you apply less nitrogen is what makes the claim conservative.

**Climate zone + the farm's irrigation method → Frac_LEACH** (`mrv.frac_leach(parameters, method)`)

Frac_LEACH is about a water surplus draining below the root zone, and there are two separate ways to get one.

In a **wet zone**, precipitation exceeds evapotranspiration, so the surplus comes from the sky. The full 0.24 applies whatever the irrigation method is, and drip does not remove it — the water is not coming from the pipe.

In a **dry zone**, rain alone leaves no surplus, so only irrigation can create one: flood and furrow do, sprinkler wets the whole profile and is treated as doing so, drip delivers to the root zone and does not, rain-fed has no irrigation at all.

The consequence worth stating plainly: **a dry-zone farm on drip gets Frac_LEACH = 0 wherever it is in the world.** Drip is not an Israeli speciality — large schemes run across Kenya and East Africa, and water scarcity moves more farms onto it every season. Nothing here is keyed off the country, and no default is applied: an unset `irrigation_method` on a dry-zone farm makes `compute_emissions` raise rather than guess, because assuming flood overstates leaching and assuming drip understates it, and either way the credit volume moves.

The method is recorded for wet-zone farms too, even though it does not change Frac_LEACH there. Under VM0042 a move to improved irrigation is an eligible project activity in its own right, so the module has to be able to hold that fact rather than infer it.

**Soil N₂O approach → what gets counted where**

This one is a genuine double-counting guard. When the approach is QA3, soil N₂O is computed on the emissions sheets from default factors. When it is QA1, soil N₂O comes from the model instead, and the QA3 figure is shown for reference but **excluded from totals**. The workbook implements this with `IF('Fixed Parameters'!$B$7="QA3", J+M, 0)` in every TOTAL cell.

In the database this must not be a per-row flag that can drift. The approach belongs to the parameter set, and the totals query reads it from there.

---

## What Stage C needs

Three tables and two views, roughly:

```sql
mrv.activity_data      -- one row per farm-year per scenario (baseline|project)
                       -- fertilizer applications as a child table, not 3 fixed
                       -- column groups as the spreadsheet does
mrv.fertilizer_applications
mrv.leakage
```

The workbook hard-codes exactly three synthetic fertilizer slots per row. That is a spreadsheet constraint, not a real one — a child table removes the ceiling and makes the FSN sum a plain aggregate.

Emissions themselves are computed, not entered. Whether they live in a view (always current, recomputed on read) or a materialised table (frozen at reporting time, which is what an auditor wants) is a Stage C decision — likely both: a view for working, a snapshot table written when a monitoring period is reported.

---

## Gaps the workbook itself flags

Its README lists these as Phase 2, and they remain open:

- Leakage §8.4.2/8.4.3/8.4.4 — entered manually with justification, defaulted to zero
- Liming and urea CO₂
- Rice CH₄
- Manure-deposition N₂O from grazing
- Buffer-pool percentage is currently 0 and must be set from the AFOLU Non-Permanence Risk Tool before any real VCU estimate

The scope is also **open-field crops only** — explicitly not orchards, groves, or forests. Given that CarboNature's client folders already split tree crops into a fruit-plantations project, a second calculator variant will eventually be needed.

---

## Coverage verified against the workbook (23 July 2026)

`mrv.compute_emissions()` was checked component-by-component against the calculator's own baseline rows, both farm-years, using an independent recomputation from the workbook inputs as the reference:

| Component | VM0042 eq. | Farm_A | Farm_B | DB matches |
|---|---|---|---|---|
| FSN / FON (N applied) | 19 / 20 | 14.8 / 0.75 | 6.3 / 0.72 t N | ✓ |
| N₂O direct | 18 | 1.6836 | 1.2668 | ✓ |
| N₂O indirect (volat + leach) | 21–23 | 0.5501 | 0.4213 | ✓ |
| N₂O from N-fixing residue | 24–25 | 0 | 0.0072 | ✓ |
| CO₂ from fuel | 6–7 | 0.5195 | 0.5195 | ✓ |
| N₂O from residue burning | 32 | 0 | 0.0005 | ✓ |
| **Total tCO₂e/ha** | | **2.7532** | **2.2152** | ✓ |

Farm_B exercises the full set — fuel, synthetic and organic N, residue burning, and N-fixing residue — and every component matches to four decimals. The database gives complete coverage of GHG emissions from fuel combustion and nitrogen-fertilizer use.

`mrv.machinery_to_diesel()` (migration 0017) completes the input side: it reproduces the workbook's Machinery-Diesel sheet (a heavy tractor over 50 ha → 3986.51 L), for the case where a fuel invoice is unavailable. The litres feed `activity_data.diesel_l`.
