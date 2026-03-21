# =============================================================================
# NoCut — CloudFront Distribution
# =============================================================================

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "nocut-media-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "signed_urls" {
  name        = "nocut-signed-urls-${var.environment}"
  encoded_key = var.cloudfront_public_key_pem
}

resource "aws_cloudfront_key_group" "signed_urls" {
  name  = "nocut-signed-urls-${var.environment}"
  items = [aws_cloudfront_public_key.signed_urls.id]
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "NoCut media CDN (${var.environment})"

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "s3-media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  # Default behavior — no cache, signed URLs required
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-media"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    trusted_key_groups = [aws_cloudfront_key_group.signed_urls.id]

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # Cache proxy videos for 24 hours
  ordered_cache_behavior {
    path_pattern           = "proxy/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-media"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    trusted_key_groups = [aws_cloudfront_key_group.signed_urls.id]

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 86400
  }

  # Cache thumbnails for 24 hours
  ordered_cache_behavior {
    path_pattern           = "thumbnails/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-media"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    trusted_key_groups = [aws_cloudfront_key_group.signed_urls.id]

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
