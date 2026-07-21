variable "region" {
  description = "AWS region. eu-west-1 per the functional spec §4."
  type        = string
  default     = "eu-west-1"
}

variable "environment" {
  description = "Environment name — dev or prod. Drives sizing and deletion protection."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "project_name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "carbonature-mrv"
}

# ---------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR for the VPC."
  type        = string
  default     = "10.30.0.0/16"
}

variable "allowed_admin_cidrs" {
  description = <<-EOT
    CIDRs permitted to reach Postgres directly. Leave empty in prod and
    reach the database through the bastion or a VPN instead.

    In dev, set this to your office/home IP as a /32 — never 0.0.0.0/0.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.allowed_admin_cidrs, "0.0.0.0/0")
    error_message = "Refusing to expose Postgres to the entire internet. Use a specific /32."
  }
}

# ---------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "carbonature_mrv"
}

variable "db_username" {
  description = "Master username. The password is generated and stored in Secrets Manager."
  type        = string
  default     = "mrv_admin"
}

variable "db_instance_class" {
  description = <<-EOT
    RDS instance class. db.t4g.micro is enough for dev and for the first
    real cycles; the spec's throughput targets (500-point map render,
    30-minute DNDC run) are compute-bound elsewhere, not in Postgres.
  EOT
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial storage in GB. Autoscales up to max_allocated_storage."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling in GB."
  type        = number
  default     = 100
}

variable "db_backup_retention_days" {
  description = <<-EOT
    Automated backup retention. Stage 7 of the work plan raises this for
    prod; the 10-year VM0042 audit trail is served by S3 + Glacier, not
    by RDS snapshots.
  EOT
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Multi-AZ failover. Roughly doubles cost — off in dev."
  type        = bool
  default     = false
}

variable "publicly_accessible" {
  description = <<-EOT
    Whether RDS gets a public endpoint. True in dev so migrations can run
    from a laptop without a bastion; must be false in prod.
  EOT
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------

variable "lab_file_retention_years" {
  description = "Retention for raw lab workbooks. NFR says 10+ years."
  type        = number
  default     = 10
}

variable "glacier_transition_days" {
  description = "Days before objects move to Glacier Instant Retrieval. NFR says 2 years."
  type        = number
  default     = 730
}
