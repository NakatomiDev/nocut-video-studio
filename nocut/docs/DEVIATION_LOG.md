# NoCut — Deviation Log

---

## Prompt 0.3.2 — Provision AWS infrastructure and verify connectivity

**Date:** 2026-03-21

### Files created/modified
- `nocut/infra/terraform/terraform.tfvars` — created with real values (gitignored)
- `nocut/infra/terraform/variables.tf` — changed default `aws_region` from `us-east-1` to `ap-northeast-1`; removed unused `cloudfront_key_pair_id` variable
- `nocut/infra/terraform/elasticache.tf` — converted `aws_elasticache_cluster` to `aws_elasticache_replication_group` (required for `auth_token` + `transit_encryption_enabled` support)
- `nocut/infra/terraform/outputs.tf` — updated Redis outputs to reference replication group `primary_endpoint_address` instead of `cache_nodes[0].address`
- `nocut/infra/scripts/verify-infra.sh` — updated ElastiCache checks to use `describe-replication-groups`; fixed `set -e` incompatibility with arithmetic expressions; accept HTTP 401 as valid Supabase reachability
- `nocut/.env` — created with real infrastructure values (gitignored)
- `nocut/.env.example` — updated region to `ap-northeast-1`
- `nocut/.terraform-outputs.json` — saved Terraform outputs (gitignored)
- `.gitignore` — added Terraform artifacts, secrets, `.terraform-outputs.json`

### Terraform apply summary
- **36 resources created**, 0 changed, 0 destroyed
- Account: `985655976031` (nocut-dev), Region: `ap-northeast-1`

### Actual resource names and endpoints
| Resource | Name/Value |
|---|---|
| S3 Bucket | `nocut-media-dev` |
| S3 Bucket ARN | `arn:aws:s3:::nocut-media-dev` |
| CloudFront Distribution ID | `E1EQB3FR3N942G` |
| CloudFront Domain | `d2o9wb5na316yq.cloudfront.net` |
| CloudFront Public Key ID | `K19P16FMCL3HPW` |
| ECR — transcoder | `985655976031.dkr.ecr.ap-northeast-1.amazonaws.com/nocut-transcoder` |
| ECR — detector | `985655976031.dkr.ecr.ap-northeast-1.amazonaws.com/nocut-detector` |
| ECR — ai-engine | `985655976031.dkr.ecr.ap-northeast-1.amazonaws.com/nocut-ai-engine` |
| ECR — exporter | `985655976031.dkr.ecr.ap-northeast-1.amazonaws.com/nocut-exporter` |
| ECS Cluster | `nocut-dev` (`arn:aws:ecs:ap-northeast-1:985655976031:cluster/nocut-dev`) |
| Redis Endpoint | `master.nocut-redis-dev.zrqind.apne1.cache.amazonaws.com:6379` |
| ECS Task Execution Role | `arn:aws:iam::985655976031:role/nocut-ecs-task-execution-dev` |
| ECS Task Role | `arn:aws:iam::985655976031:role/nocut-ecs-task-dev` |

### Deviations from spec
1. **Region changed**: Used `ap-northeast-1` instead of `us-east-1` (user's AWS account is configured for Tokyo region)
2. **ElastiCache resource type changed**: `aws_elasticache_cluster` → `aws_elasticache_replication_group` because `auth_token` and `transit_encryption_enabled` are only supported on replication groups
3. **`cloudfront_key_pair_id` variable removed**: It was defined in `variables.tf` but never referenced in any resource — the CloudFront public key is created by Terraform and the ID is derived automatically
4. **Step 4 (Supabase link) skipped**: `supabase` CLI is not installed in this environment
5. **Step 6 (Docker build/push) skipped**: Docker daemon is not running in this environment; ECR login was verified successfully via AWS API

### Verification results
All 12 infrastructure checks passed:
- AWS credentials, S3 (exists + read/write), 4 ECR repos, ECR login, ECS cluster, CloudFront distribution, ElastiCache replication group, Supabase API reachable
- Redis direct ping: expected warning (not in VPC)
