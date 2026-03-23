# =============================================================================
# NoCut — AWS MediaConvert (serverless video assembly)
#
# Replaces the Docker exporter service for stitching source segments
# and AI fill clips into the final exported video.
# =============================================================================

# -----------------------------------------------------------------------------
# IAM Role for MediaConvert (assumed by the service to read/write S3)
# -----------------------------------------------------------------------------
resource "aws_iam_role" "mediaconvert" {
  name = "nocut-mediaconvert-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "mediaconvert.amazonaws.com" }
      }
    ]
  })
}

resource "aws_iam_role_policy" "mediaconvert_s3" {
  name = "nocut-mediaconvert-s3-${var.environment}"
  role = aws_iam_role.mediaconvert.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ReadSource"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.media.arn,
          "${aws_s3_bucket.media.arn}/*"
        ]
      },
      {
        Sid    = "S3WriteExports"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
        ]
        Resource = "${aws_s3_bucket.media.arn}/exports/*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# MediaConvert API Endpoint
#
# Each AWS account has a unique MediaConvert endpoint per region.
# Retrieve it once with:
#   aws mediaconvert describe-endpoints --region ap-northeast-1 \
#     --query 'Endpoints[0].Url' --output text
#
# Then set it in terraform.tfvars:
#   mediaconvert_endpoint = "https://abc123.mediaconvert.ap-northeast-1.amazonaws.com"
# -----------------------------------------------------------------------------
