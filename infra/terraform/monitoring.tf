# =====================================================================
# Stage 7 — monitoring
#
# The RDS itself is already hardened (rds.tf): deletion protection and a
# final snapshot in prod, automated backups, point-in-time recovery,
# Performance Insights, and Postgres logs to CloudWatch. What stage 7
# adds is the alarm that matters for this account specifically — the
# Free-plan credit balance is the real cliff, not disk or CPU.
#
# Estimated-charges alarms live only in us-east-1, so this file pins a
# provider alias there. Billing alerts must also be enabled once in the
# Billing console (Billing preferences -> "Receive CloudWatch billing
# alerts") — a one-time account setting Terraform cannot flip.
# =====================================================================

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "carbonature-mrv"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

variable "billing_alarm_usd" {
  description = <<-EOT
    Raise an alarm when estimated month-to-date charges cross this many
    USD. On the Free plan usage draws down credits rather than charging
    the card, but a positive estimated-charges figure means credits are
    exhausted and real billing has begun — which is exactly the moment to
    know about. Set low.
  EOT
  type        = number
  default     = 5
}

variable "alarm_email" {
  description = "Email to notify on the billing alarm. Empty disables the SNS topic and subscription."
  type        = string
  default     = ""
}

resource "aws_sns_topic" "alarms" {
  count    = var.alarm_email == "" ? 0 : 1
  provider = aws.us_east_1
  name     = "${var.project_name}-${var.environment}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count     = var.alarm_email == "" ? 0 : 1
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "estimated_charges" {
  provider            = aws.us_east_1
  alarm_name          = "${var.project_name}-${var.environment}-estimated-charges"
  alarm_description   = "Estimated month-to-date charges exceeded $${var.billing_alarm_usd}. On the Free plan this means credits are exhausted and real billing has started."
  namespace           = "AWS/Billing"
  metric_name         = "EstimatedCharges"
  dimensions          = { Currency = "USD" }
  statistic           = "Maximum"
  period              = 21600 # 6 h — the metric only updates a few times a day
  evaluation_periods  = 1
  threshold           = var.billing_alarm_usd
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
}

# Low free-storage on the database — long before autoscaling would be a
# surprise, catch it. Uses the default region provider (the DB is there).
resource "aws_cloudwatch_metric_alarm" "rds_low_storage" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-low-storage"
  alarm_description   = "RDS free storage below 2 GB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2 * 1024 * 1024 * 1024 # 2 GB in bytes
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
}
