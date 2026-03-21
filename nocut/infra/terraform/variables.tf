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

# -----------------------------------------------------------------------------
# ECS Service Configuration
# -----------------------------------------------------------------------------

variable "supabase_url" {
  description = "Supabase project URL"
  type        = string
}

variable "transcoder_cpu" {
  description = "CPU units for the transcoder task (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "transcoder_memory" {
  description = "Memory (MiB) for the transcoder task"
  type        = number
  default     = 2048
}

variable "transcoder_desired_count" {
  description = "Desired number of transcoder tasks"
  type        = number
  default     = 1
}

variable "detector_cpu" {
  description = "CPU units for the detector task (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "detector_memory" {
  description = "Memory (MiB) for the detector task"
  type        = number
  default     = 1024
}

variable "detector_desired_count" {
  description = "Desired number of detector tasks"
  type        = number
  default     = 1
}
