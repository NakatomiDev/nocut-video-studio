# =============================================================================
# NoCut — Input Variables
# =============================================================================

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "ap-northeast-1"
}

variable "s3_bucket_name" {
  description = "Name for the media S3 bucket (will be suffixed with environment)"
  type        = string
  default     = "nocut-media"
}

variable "cloudfront_public_key_pem" {
  description = "PEM-encoded public key for CloudFront signed URLs"
  type        = string
  sensitive   = true
}

variable "redis_auth_token" {
  description = "Auth token for ElastiCache Redis"
  type        = string
  sensitive   = true
}
