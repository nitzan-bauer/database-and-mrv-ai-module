output "db_endpoint" {
  description = "RDS endpoint, host:port."
  value       = aws_db_instance.main.endpoint
}

output "db_name" {
  description = "Database name."
  value       = aws_db_instance.main.db_name
}

output "db_secret_arn" {
  description = "Secrets Manager ARN holding the master credentials and the ready-made DATABASE_URL."
  value       = aws_secretsmanager_secret.db.arn
}

output "db_secret_name" {
  description = "Secret name — fetch the connection string with: aws secretsmanager get-secret-value --secret-id <this> --query SecretString --output text | jq -r .url"
  value       = aws_secretsmanager_secret.db.name
}

output "s3_buckets" {
  description = "Bucket names by purpose."
  value       = { for k, b in aws_s3_bucket.main : k => b.id }
}

output "kms_key_arn" {
  description = "Customer-managed key protecting RDS, S3 and Secrets Manager."
  value       = aws_kms_key.main.arn
}

output "vpc_id" {
  description = "VPC id."
  value       = aws_vpc.main.id
}

output "db_security_group_id" {
  description = "Security group guarding Postgres — attach app and model-runner tasks to it."
  value       = aws_security_group.db.id
}
