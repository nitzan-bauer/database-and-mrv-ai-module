# Where the functional spec is out of date

`Carbonature_AI_Soil_Module_Spec_v1.0.pdf` was written in April 2026. It remains the best statement of *what the module does* — nine screens, four personas, the MCP sampler design, the compliance checklist. Its architecture and data-model sections have drifted.

This is the list to work through before Phase 2 starts. Nothing here has been decided unilaterally; the schema was built so that each of these stays open.

---

## 1. The hierarchy gained a level

The spec's data model runs `projects → plots → sample_points`. Since then the grouped-project structure was worked out properly: a Verra grouped project is an umbrella, and each participating farm is a separate instance added over time.

The hierarchy is now:

```
projects (grouped Verra umbrella)  →  farms  →  plots  →  strata  →  sampling_points
```

The spec is not wrong so much as incomplete — its own §11 already carries CropNut's `Installation` column ("RAI group farm TZ"), which *is* the farm. It just mapped it as a text field rather than an entity.

Consequences: each farm owns its plots, its baseline control sites, its strata, and its own sampling campaign. `carbon_rights_ref` sits on the farm, because each farmer signs a separate agreement — the practical guard against double-counting.

## 2. The SOC formula factor is wrong in §11

The spec gives `(TOC%/100) × BD × depth × 1000`. The GHG calculator gives ×100, and so does standard IPCC/Verra practice. See the README for the worked check. Implemented as ×100; still worth a written confirmation from CropNut.

## 3. Sample ID width contradicts itself — resolved

§11 says 10 digits zero-padded; every mockup shows 8 (`OFM00021615`).

**Settled 21 July 2026: 10 digits** — `OFM` + 10 zero-padded digits, a 13-character identifier. The mockups are illustrative; the spec text, the work plan and Nitzan all say 10.

`mrv.next_sample_id()` pads to 8 today and is corrected when stage 3 lands. No sample rows exist yet, so the change is free now and would not be once IDs are printed on physical bags.

## 4. The stack question is genuinely open

The spec locks AWS: RDS PostgreSQL+PostGIS, S3, Lambda, ECS Fargate, Cognito, React frontend.

Meanwhile the customer-facing SaaS shipped on **Next.js + Supabase + Vercel**. Two clouds for one company is a real cost, and the spec's own choices were made before that stack existed.

What is affected: every storage URL column (S3 bucket vs Supabase Storage), the Excel ingestion pipeline (IMAP + S3 trigger + Lambda vs a Next.js route or Edge Function), and the model runners — which genuinely do want containers, since DNDC and DayCent are CLI binaries that Vercel cannot host. A split is defensible: Supabase for data and app, a container host for model runs only.

Stage A deliberately avoids the question. No storage-provider assumption is baked into the schema.

## 5. Quantification Approach 3 is missing entirely

The spec covers QA1 (measure & model) and QA2 (measure & remeasure). The GHG calculator is built on **QA3 — default emission factors**, which is what fuel, residue burning, and (usually) soil N₂O actually use.

This is the largest gap. The spec's data model has no fertilizer applications, no fuel consumption, no residue data, no emission factors — none of the accounting layer. `quant_approach` now includes `QA3`, and Stage C builds the tables.

## 6. Leakage is absent

Not mentioned in the spec. VM0042 §8.4 requires it, and the calculator computes §8.4.1 (organic amendments) automatically while leaving 8.4.2-8.4.4 as justified entries. Stage C.

## 7. The CRM section is stale

§9 recommends HubSpot. That evaluation predates the SaaS build and the current CRM discussion, and should be re-run rather than inherited.

## 8. Single-tenant assumption

§4 and §12 assume one tenant, internal users only, farmer details living "in the future CRM, not in the platform". But farmers now register on `app.carbonature.io` and have accounts. The relationship between a SaaS farmer account and an MRV `farms` row needs deciding — same row, or bridged by a foreign key.

---

## What has held up well

Worth saying, because most of the spec is still the plan:

- The four personas, and specifically the insight that samplers should not have accounts at all — a work-order-scoped token is the right shape.
- The MCP design for field capture. Uniform tool surface for agent and human, audit-friendly, and a native app later would reuse it unchanged.
- The nine screens and their priority tiers.
- The compliance checklist in Appendix A — every rule maps to a VM0042 section, which is exactly what the rule engine needs.
- Append-only evidentiary data and provenance for lab files. Stage A implements this with triggers.
