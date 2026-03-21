# =============================================================================
# NoCut — Outputs
# =============================================================================

output "s3_bucket_name" {
  description = "Media S3 bucket name"
  value       = aws_s3_bucket.media.id
}

output "s3_bucket_arn" {
  description = "Media S3 bucket ARN"
  value       = aws_s3_bucket.media.arn
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.media.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.media.domain_name
}

output "cloudfront_url" {
  description = "CloudFront HTTPS URL"
  value       = "https://${aws_cloudfront_distribution.media.domain_name}"
}

output "ecr_repository_urls" {
  description = "ECR repository URLs for each service"
  value = {
    transcoder = aws_ecr_repository.services["nocut-transcoder"].repository_url
    detector   = aws_ecr_repository.services["nocut-detector"].repository_url
    ai_engine  = aws_ecr_repository.services["nocut-ai-engine"].repository_url
    exporter   = aws_ecr_repository.services["nocut-exporter"].repository_url
  }
}

output "ecs_cluster_name" {
  description = "ECS Fargate cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS Fargate cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  description = "ElastiCache Redis port"
  value       = 6379
}

output "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = aws_iam_role.ecs_task.arn
}
