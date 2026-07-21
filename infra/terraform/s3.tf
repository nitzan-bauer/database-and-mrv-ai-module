# =====================================================================
# S3 — three private, KMS-encrypted buckets.
#
#   labs      raw lab workbooks. The audit-critical one: VM0042 wants the
#             original file, unmodified, for the project lifetime. Versioned,
#             object-locked in prod, and kept for lab_file_retention_years.
#   field     sampler photos and generated work-order PDFs.
#   models    DNDC/DayCent run inputs, logs and outputs (Stage 6).
#
# Bucket names are globally unique across all of AWS, so they carry a
# random suffix rather than risking a collision on a guessable name.
# =====================================================================

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

locals {
  # Tag values: S3 allows only letters, numbers, spaces and + - = . _ : / @
  # No commas, no em-dashes — InvalidTag otherwise.
  buckets = {
    labs   = "Raw lab workbooks - audit evidence - never mutated"
    field  = "Sampler photos and work-order PDFs"
    models = "Model run inputs logs and outputs"
  }

  bucket_names = {
    for k, _ in local.buckets :
    k => "${var.project_name}-${var.environment}-${k}-${random_id.bucket_suffix.hex}"
  }
}

resource "aws_s3_bucket" "main" {
  for_each = local.buckets

  bucket = local.bucket_names[each.key]

  # Prod buckets hold audit evidence; refuse to delete a non-empty one.
  force_destroy = var.environment != "prod"

  tags = {
    Name    = local.bucket_names[each.key]
    Purpose = each.value
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  for_each = aws_s3_bucket.main

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  for_each = aws_s3_bucket.main

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    # Cuts KMS request cost sharply on buckets with many small objects.
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "main" {
  for_each = aws_s3_bucket.main

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Reject any upload that is not KMS-encrypted, and any plaintext transport.
resource "aws_s3_bucket_policy" "main" {
  for_each = aws_s3_bucket.main

  bucket = each.value.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [each.value.arn, "${each.value.arn}/*"]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
      {
        Sid       = "DenyUnencryptedUploads"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${each.value.arn}/*"
        Condition = {
          StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" }
        }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.main]
}

# ---------------------------------------------------------------------
# Lifecycle — Glacier after 2 years, retain 10+ (NFR §12).
# Applied to the lab bucket only: field photos and model outputs are
# regenerable or non-evidentiary and do not need decade-long custody.
# ---------------------------------------------------------------------
resource "aws_s3_bucket_lifecycle_configuration" "labs" {
  bucket = aws_s3_bucket.main["labs"].id

  rule {
    id     = "archive-then-retain"
    status = "Enabled"

    filter {}

    transition {
      days          = var.glacier_transition_days
      storage_class = "GLACIER_IR"
    }

    expiration {
      days = var.lab_file_retention_years * 365
    }

    noncurrent_version_transition {
      noncurrent_days = var.glacier_transition_days
      storage_class   = "GLACIER_IR"
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
