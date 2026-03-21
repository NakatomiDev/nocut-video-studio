# =============================================================================
# NoCut — ECR Repositories
# =============================================================================

locals {
  ecr_repositories = toset([
    "nocut-transcoder",
    "nocut-detector",
    "nocut-ai-engine",
    "nocut-exporter",
  ])
}

resource "aws_ecr_repository" "services" {
  for_each             = local.ecr_repositories
  name                 = each.key
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = local.ecr_repositories
  repository = aws_ecr_repository.services[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
