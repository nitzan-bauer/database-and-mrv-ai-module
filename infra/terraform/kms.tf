# =====================================================================
# KMS — one customer-managed key for data at rest (RDS + S3 + secrets).
#
# A single key keeps rotation and grants simple at this scale. Split it
# per-service only if a compliance requirement forces separate custody.
# =====================================================================

resource "aws_kms_key" "main" {
  description             = "${var.project_name} ${var.environment} — data at rest"
  enable_key_rotation     = true
  deletion_window_in_days = var.environment == "prod" ? 30 : 7

  tags = { Name = "${var.project_name}-${var.environment}-kms" }
}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.project_name}-${var.environment}"
  target_key_id = aws_kms_key.main.key_id
}
