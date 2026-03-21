# =============================================================================
# NoCut — ECS Cluster, Task Definitions & Services (Fargate)
# =============================================================================

# -----------------------------------------------------------------------------
# Cluster
# -----------------------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "nocut-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# -----------------------------------------------------------------------------
# CloudWatch Log Groups
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "transcoder" {
  name              = "/ecs/nocut-transcoder-${var.environment}"
  retention_in_days = var.environment == "prod" ? 30 : 7
}

resource "aws_cloudwatch_log_group" "detector" {
  name              = "/ecs/nocut-detector-${var.environment}"
  retention_in_days = var.environment == "prod" ? 30 : 7
}

# -----------------------------------------------------------------------------
# Task Definition — Transcoder
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "transcoder" {
  family                   = "nocut-transcoder-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.transcoder_cpu
  memory                   = var.transcoder_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "transcoder"
      image     = "${aws_ecr_repository.services["nocut-transcoder"].repository_url}:latest"
      essential = true

      environment = [
        { name = "NODE_ENV", value = var.environment == "prod" ? "production" : "development" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = aws_s3_bucket.media.id },
        { name = "SUPABASE_URL", value = var.supabase_url },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.redis.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "REDIS_TLS", value = "true" },
        { name = "WORKER_CONCURRENCY", value = "2" },
      ]

      secrets = [
        { name = "SUPABASE_SERVICE_ROLE_KEY", valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:nocut/supabase-service-role-key" },
        { name = "REDIS_PASSWORD", valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:nocut/redis-auth-token" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.transcoder.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e 'process.exit(0)'"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

# -----------------------------------------------------------------------------
# Task Definition — Detector
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "detector" {
  family                   = "nocut-detector-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.detector_cpu
  memory                   = var.detector_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "detector"
      image     = "${aws_ecr_repository.services["nocut-detector"].repository_url}:latest"
      essential = true

      environment = [
        { name = "ENVIRONMENT", value = var.environment },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = aws_s3_bucket.media.id },
        { name = "SUPABASE_URL", value = var.supabase_url },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.redis.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "REDIS_TLS", value = "true" },
      ]

      secrets = [
        { name = "SUPABASE_SERVICE_ROLE_KEY", valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:nocut/supabase-service-role-key" },
        { name = "REDIS_PASSWORD", valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:nocut/redis-auth-token" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.detector.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "python -c 'import sys; sys.exit(0)'"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

# -----------------------------------------------------------------------------
# Service — Transcoder
# -----------------------------------------------------------------------------
resource "aws_ecs_service" "transcoder" {
  name            = "nocut-transcoder-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.transcoder.arn
  desired_count   = var.transcoder_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true # Required for Fargate in public subnets (ECR pull, S3, etc.)
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [desired_count] # Allow autoscaling to manage count
  }
}

# -----------------------------------------------------------------------------
# Service — Detector
# -----------------------------------------------------------------------------
resource "aws_ecs_service" "detector" {
  name            = "nocut-detector-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.detector.arn
  desired_count   = var.detector_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [desired_count]
  }
}
