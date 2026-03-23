# =============================================================================
# NoCut — ElastiCache Redis (BullMQ)
# =============================================================================

resource "aws_elasticache_subnet_group" "redis" {
  name       = "nocut-redis-${var.environment}"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "nocut-redis-${var.environment}"
  description          = "NoCut Redis for BullMQ (${var.environment})"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.environment == "prod" ? "cache.t3.small" : "cache.t3.micro"
  num_cache_clusters   = 1
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token
}
