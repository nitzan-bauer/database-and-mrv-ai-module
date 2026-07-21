# Stage 0 — Infrastructure

Goal: a dev environment with an empty, ready database.

Everything is written as code and validated. **Nothing has been provisioned** — `terraform apply` spends money, and neither the AWS CLI nor Terraform is installed on this machine, so the last step is yours.

---

## What Stage 0 delivers

| Item | Where | Status |
|---|---|---|
| VPC, subnets, security group | `infra/terraform/network.tf` | Written |
| RDS PostgreSQL 16, gp3, KMS-encrypted | `infra/terraform/rds.tf` | Written |
| Master password → Secrets Manager | `infra/terraform/rds.tf` | Written |
| KMS customer-managed key, rotating | `infra/terraform/kms.tf` | Written |
| Three private S3 buckets + lifecycle | `infra/terraform/s3.tf` | Written |
| Extensions: postgis, pgvector, pgcrypto, citext | `migrations/0001` | Written |
| Migration tool chosen and wired | dbmate — see [CONVENTIONS.md](CONVENTIONS.md) | Done |
| Naming and schema conventions | [CONVENTIONS.md](CONVENTIONS.md) | Done |
| Repo + CI | `.github/workflows/ci.yml` | Done |

CI is the part that works today with no AWS account at all: it stands up PostgreSQL 16 + PostGIS + pgvector in a container, applies every migration, rolls the entire stack back, re-applies it, seeds twice to prove idempotency, and runs the verification suite. That is stronger evidence than a syntax check.

---

## Prerequisites

Install locally (none are present today):

```powershell
winget install Hashicorp.Terraform
winget install Amazon.AWSCLI
winget install PostgreSQL.psql        # or the full PostgreSQL installer
```

dbmate is a single binary — download `dbmate-windows-amd64.exe` from its releases page and put it on your PATH.

Then configure AWS. An IAM user with `AdministratorAccess` is fine to start; tighten it once the stack settles.

```bash
aws configure          # key, secret, region eu-west-1
aws sts get-caller-identity   # confirm it works
```

---

## Provisioning

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars

# Put your public IP in allowed_admin_cidrs, as a /32
curl -s https://checkip.amazonaws.com

terraform init
terraform plan          # read this properly before applying
terraform apply
```

`plan` should show roughly 30 resources. Nothing in it is billable until `apply`.

## Connecting

The connection string is assembled for you and stored in Secrets Manager:

```bash
aws secretsmanager get-secret-value \
  --secret-id carbonature-mrv/dev/db \
  --query SecretString --output text | jq -r .url
```

Put it in `.env` at the repo root (gitignored):

```
DATABASE_URL="postgresql://mrv_admin:...@carbonature-mrv-dev...rds.amazonaws.com:5432/carbonature_mrv?sslmode=require"
```

## Applying the schema

```bash
dbmate --migrations-dir ./migrations up
psql "$DATABASE_URL" -f seeds/0001_reference_data.sql
psql "$DATABASE_URL" -f scripts/verify.sql
```

Every line of the verify output should read `PASS`. That is the end of Stage 0: an empty, ready database — plus, since Stage A was already built, the spatial core is in place too.

One note on extensions: `CREATE EXTENSION vector` needs `rds_superuser`, which the master user has. If it fails, check the RDS PG16 minor version — pgvector landed in 16.1.

---

## Cost

Approximate, eu-west-1, USD/month:

| | dev (as configured) | prod (multi-AZ, private) |
|---|---|---|
| RDS instance | ~$12 (db.t4g.micro) | ~$50 (db.t4g.small, Multi-AZ) |
| Storage 20 GB gp3 | ~$2 | ~$5 |
| Backups | included at 7 days | ~$3 |
| KMS key | $1 | $1 |
| S3 + requests | <$1 initially | a few $ |
| Secrets Manager | $0.40 | $0.40 |
| **Total** | **~$17/mo** | **~$65/mo** |

Two deliberate omissions that keep this low:

**No NAT gateway.** It is ~$33/month before data charges, and nothing needs outbound internet from a private subnet yet. Stage 6's model runners will; add it then.

**No bastion.** Dev RDS is publicly accessible but firewalled to your `/32`, which is why `allowed_admin_cidrs` has a validation rule rejecting `0.0.0.0/0`. For prod, set `publicly_accessible = false` and reach it through a bastion or VPN.

---

## Worth deciding before you apply

The work plan specifies RDS, and that is what this builds. But the SaaS already runs on Supabase, and Supabase Pro is $25/month for managed Postgres with PostGIS and pgvector available, plus storage and auth — overlapping much of what this stack provisions.

The honest comparison:

**RDS wins on** control over the Postgres version and parameters, native integration with the containerised DNDC/DayCent runners (which want ECS/Fargate in the same VPC either way), IAM-scoped S3 with object lock for audit evidence, and no ceiling on database size or connection count.

**Supabase wins on** one vendor instead of two, one bill, no VPC to maintain, and — the substantive one — the ability to join MRV data against the marketplace tables directly. Under RDS, linking a farm in this database to a farmer account in the SaaS means syncing across two systems rather than a foreign key.

The schema is deliberately provider-agnostic; the `mrv` schema was chosen precisely so this stays reversible. Migrating later means a `pg_dump` and a restore, not a rewrite. So this is not a one-way door, and starting on RDS as planned is defensible — just worth being deliberate about, since the model runners are the only requirement that genuinely forces AWS, and they are Stage 6.

---

## Next

Stage 1 is largely built already — the spatial core and its GIST indexes exist in `migrations/0003`. What remains is the data work: seeding Kisima, RAI and Casterra, importing the plot polygons from the existing GeoJSON, wiring the one-way PostGIS → Mapbox sync via the `polygons-for-mapbox` skill, and the acceptance test that a point-in-plot spatial query returns the right answer.

For that I need the GeoJSON files and confirmation of which farm sits under which grouped project.
