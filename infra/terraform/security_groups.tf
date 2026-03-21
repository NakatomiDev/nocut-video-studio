# =============================================================================
# NoCut — Security Groups
# =============================================================================

# Redis security group — allows inbound from ECS tasks only
resource "aws_security_group" "redis" {
  name        = "nocut-redis-${var.environment}"
  description = "Allow Redis access from ECS tasks"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group_rule" "redis_ingress" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.redis.id
}

# ECS tasks security group — allows outbound to internet and Redis
resource "aws_security_group" "ecs_tasks" {
  name        = "nocut-ecs-tasks-${var.environment}"
  description = "Security group for NoCut ECS tasks"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group_rule" "ecs_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_tasks.id
}
