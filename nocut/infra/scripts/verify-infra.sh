#!/usr/bin/env bash
# =============================================================================
# NoCut — Infrastructure Verification Script
# Verifies all AWS resources are reachable after terraform apply.
# Usage: ./infra/scripts/verify-infra.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env if present
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

PASS=0
FAIL=0
RESULTS=()

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    RESULTS+=("✓ $name")
    ((PASS++))
  else
    RESULTS+=("✗ $name")
    ((FAIL++))
  fi
}

echo "============================================"
echo " NoCut Infrastructure Verification"
echo "============================================"
echo ""

# ── 1. AWS Credentials ──
echo "Checking AWS credentials..."
check "AWS credentials valid" aws sts get-caller-identity

# ── 2. S3 Bucket ──
echo "Checking S3 bucket..."
BUCKET="${AWS_S3_BUCKET:-}"
if [[ -z "$BUCKET" ]]; then
  echo "  AWS_S3_BUCKET not set, trying terraform output..."
  BUCKET=$(cd "$REPO_ROOT/infra/terraform" && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
fi

if [[ -n "$BUCKET" ]]; then
  check "S3 bucket exists" aws s3api head-bucket --bucket "$BUCKET"

  # Upload/download/delete test
  echo "test" > /tmp/nocut-infra-test.txt
  if aws s3 cp /tmp/nocut-infra-test.txt "s3://$BUCKET/test/connectivity-check.txt" >/dev/null 2>&1; then
    aws s3 cp "s3://$BUCKET/test/connectivity-check.txt" /tmp/nocut-infra-download.txt >/dev/null 2>&1
    if diff /tmp/nocut-infra-test.txt /tmp/nocut-infra-download.txt >/dev/null 2>&1; then
      RESULTS+=("✓ S3 read/write")
      ((PASS++))
    else
      RESULTS+=("✗ S3 read/write (content mismatch)")
      ((FAIL++))
    fi
    aws s3 rm "s3://$BUCKET/test/connectivity-check.txt" >/dev/null 2>&1
    rm -f /tmp/nocut-infra-test.txt /tmp/nocut-infra-download.txt
  else
    RESULTS+=("✗ S3 read/write (upload failed)")
    ((FAIL++))
  fi
else
  RESULTS+=("✗ S3 bucket (AWS_S3_BUCKET not set)")
  ((FAIL++))
fi

# ── 3. ECR Repositories ──
echo "Checking ECR repositories..."
REGION="${AWS_REGION:-ap-northeast-1}"
for repo in nocut-transcoder nocut-detector nocut-ai-engine nocut-exporter; do
  check "ECR repo: $repo" aws ecr describe-repositories --repository-names "$repo" --region "$REGION"
done

# ── 4. ECR Login ──
echo "Checking ECR login..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [[ -n "$ACCOUNT_ID" ]]; then
  check "ECR login" bash -c "aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
else
  RESULTS+=("✗ ECR login (could not get account ID)")
  ((FAIL++))
fi

# ── 5. ECS Cluster ──
echo "Checking ECS cluster..."
ENV="${ENVIRONMENT:-dev}"
check "ECS cluster: nocut-$ENV" aws ecs describe-clusters --clusters "nocut-$ENV" --region "$REGION" --query "clusters[?status=='ACTIVE'].clusterName" --output text

# ── 6. CloudFront Distribution ──
echo "Checking CloudFront distribution..."
CF_DOMAIN=$(cd "$REPO_ROOT/infra/terraform" && terraform output -raw cloudfront_domain_name 2>/dev/null || echo "")
if [[ -n "$CF_DOMAIN" ]]; then
  check "CloudFront distribution" aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='$CF_DOMAIN'].Status" --output text
else
  check "CloudFront (any nocut distribution)" aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='NoCut media CDN ($ENV)'].DomainName" --output text
fi

# ── 7. ElastiCache Redis ──
echo "Checking ElastiCache Redis..."
check "ElastiCache replication group: nocut-redis-$ENV" aws elasticache describe-replication-groups --replication-group-id "nocut-redis-$ENV" --region "$REGION"

# Redis connectivity (only works from within VPC or via VPN/bastion)
REDIS_HOST=$(aws elasticache describe-replication-groups --replication-group-id "nocut-redis-$ENV" --region "$REGION" --query "ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address" --output text 2>/dev/null || echo "")
if [[ -n "$REDIS_HOST" && "$REDIS_HOST" != "None" ]]; then
  echo "  Redis endpoint: $REDIS_HOST"
  if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli -h "$REDIS_HOST" -p 6379 --tls -a "${REDIS_AUTH_TOKEN:-}" ping >/dev/null 2>&1; then
      RESULTS+=("✓ Redis ping (direct)")
      ((PASS++))
    else
      RESULTS+=("⚠ Redis ping (not reachable — expected if not in VPC)")
      # Don't count as fail since we're likely outside the VPC
    fi
  fi
fi

# ── 8. Supabase API ──
echo "Checking Supabase connectivity..."
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
if [[ -n "$SUPABASE_URL" && -n "$SUPABASE_ANON_KEY" ]]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" =~ ^(200|401)$ ]]; then
    RESULTS+=("✓ Supabase API reachable (HTTP $HTTP_CODE)")
    ((PASS++)) || true
  else
    RESULTS+=("✗ Supabase API (HTTP $HTTP_CODE)")
    ((FAIL++)) || true
  fi
else
  RESULTS+=("⚠ Supabase (SUPABASE_URL or SUPABASE_ANON_KEY not set)")
fi

# ── Summary ──
echo ""
echo "============================================"
echo " Results"
echo "============================================"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo ""
echo "  Passed: $PASS  |  Failed: $FAIL"
echo "============================================"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
