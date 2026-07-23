# Stage 7 — Hardening, backups, audit-readiness

## ✅ Done — 23 July 2026

The final database stage, split between the schema and the infrastructure. 30 verification checks pass against the live instance; two CloudWatch alarms are live in AWS.

## The database half — audit-readiness (migration 0016)

Stage 7's database work is not more schema; it is the ability to *prove* what the schema holds. Three read-only artefacts, nothing that changes stored data.

**`v_sample_chain`** — the query a VVB effectively runs. One row per SOC measurement, joining the whole evidence chain: farm → plot → stratum → point → event → sample → measurement, with the lab, its ISO 17025 status, and the import provenance (workbook URL and SHA-256) attached. Given any credited figure, this shows the physical sample it rests on and where that sample's data came from.

**`v_data_completeness`** — per farm-cycle, is every link present? Planned points versus captured events, how many events are locked, samples, SOC and texture measurements, and — the audit-critical one — how many measurements are missing their lab-import provenance. A gap shows here before an auditor finds it.

**`mrv.audit_trail(type, id)`** — `audit_log` is polymorphic (no FK), so this is the readable way to ask "everything that happened to plot ELD-WP-01, in order".

**`retention_policy`** — a small table declaring where each class of evidence is retained, for how long, and what enforces it: the append-only triggers for SOC evidence, S3 lifecycle for lab files, RDS for backups. Documentation surfaced in-database, next to the data it describes.

The acceptance test walked a full synthetic chain on a real demo plot and read it straight back through `v_sample_chain` — farm, plot, stratum, TOC, lab, SHA-256, lock state, all present — then confirmed `v_data_completeness` reported zero missing provenance and the audit trail recorded the insert.

## The infrastructure half

Most of it was already in Terraform from stage 0, which is why stage 7 adds little here:

- **RDS**: automated backups, point-in-time recovery, `deletion_protection` and a mandatory `final_snapshot` in prod, Performance Insights, Postgres logs to CloudWatch — all pre-existing.
- **S3**: lifecycle to Glacier at 2 years, 10-year retention on the lab bucket, versioned and KMS-encrypted — pre-existing.
- **Spatial indexes**: the GIST indexes from stage 1 already meet the NFR. Migration 0016 runs `ANALYZE` on the spatial tables so the planner has fresh statistics after the demo seed. The verification suite times point-in-plot on every run and asserts it stays under the 2 s / 500-point target — it clocks in the single-digit milliseconds.

What stage 7 genuinely adds is **monitoring** (`monitoring.tf`), aimed at this account's real failure mode:

- **Estimated-charges alarm** (us-east-1, where billing metrics live). On the Free plan usage draws down credits rather than charging the card, so a *positive* estimated-charges figure is the signal that credits are exhausted and real billing has begun. Threshold $5. That is the cliff worth watching, not CPU.
- **Low-storage alarm** — RDS free storage under 2 GB, well before autoscaling would surprise anyone.

Both are live in AWS (`INSUFFICIENT_DATA` until a metric crosses, as expected). Two one-time manual steps remain, which Terraform cannot do: enabling CloudWatch billing alerts in the Billing console, and — to actually receive the alerts — setting `alarm_email` in `terraform.tfvars` and confirming the SNS subscription email.

## Where the database stands

Seven stages, done and verified live. 41 base tables, four views, 16 migrations, 30 verification checks passing both in CI and against RDS. Every evidentiary table append-only; every change audited; the whole evidence chain traceable from a credit back to a core.

The database is complete. What remains is deliberately out of the database's scope and documented as such: the DNDC/DayCent model integration (containers + NAT gateway + service code), the Eq. 74 uncertainty computation (service layer), the ingestion pipeline (application), the PostGIS → Mapbox sync (pending the geometry-ownership decision), and RLS enablement (needs the application role). Those belong to the AI-MRV module, which is the next phase.
