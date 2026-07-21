# =====================================================================
# RDS PostgreSQL 16 + PostGIS
#
# The extensions themselves are created by migration 0001; RDS only needs
# to permit them. postgis, vector, pgcrypto and citext are all on the RDS
# PG16 shared_preload/allowed list without special handling.
# =====================================================================

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}"
  subnet_ids = var.publicly_accessible ? aws_subnet.public[*].id : aws_subnet.private[*].id

  tags = { Name = "${var.project_name}-${var.environment}-subnet-group" }
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.project_name}-${var.environment}-pg16"
  family = "postgres16"

  # Log slow queries — the spec's map-render NFR (<2s for 500 points) is
  # the thing most likely to regress, and this makes it visible.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Master password: generated, never written to state in plaintext by us,
# and handed to Secrets Manager. Rotate via Secrets Manager, not here.
resource "random_password" "db" {
  length  = 32
  special = true
  # RDS rejects these in a master password.
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db" {
  name        = "${var.project_name}/${var.environment}/db"
  description = "Master credentials for the MRV database"
  kms_key_id  = aws_kms_key.main.arn

  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id

  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db.result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
    url      = "postgresql://${var.db_username}:${urlencode(random_password.db.result)}@${aws_db_instance.main.endpoint}/${var.db_name}?sslmode=require"
  })
}

resource "aws_db_instance" "main" {
  identifier = "${var.project_name}-${var.environment}"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = var.publicly_accessible
  parameter_group_name   = aws_db_parameter_group.main.name

  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_days
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "prod"

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.main.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Guard rails: prod refuses to be destroyed and always leaves a snapshot.
  deletion_protection       = var.environment == "prod"
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-prod-final" : null

  tags = { Name = "${var.project_name}-${var.environment}-db" }
}
