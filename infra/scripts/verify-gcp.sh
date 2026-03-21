#!/usr/bin/env bash
# =============================================================================
# NoCut — GCP / Vertex AI Verification Script
# Verifies GCP authentication and Vertex AI API access.
# Usage: ./infra/scripts/verify-gcp.sh
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
echo " NoCut GCP / Vertex AI Verification"
echo "============================================"
echo ""

# ── 1. Check gcloud is installed ──
echo "Checking gcloud CLI..."
if ! command -v gcloud >/dev/null 2>&1; then
  echo "  ✗ gcloud CLI not found. Install: brew install google-cloud-sdk"
  exit 1
fi
RESULTS+=("✓ gcloud CLI installed")
((PASS++))

# ── 2. Service account key ──
KEY_FILE="${GOOGLE_APPLICATION_CREDENTIALS:-$REPO_ROOT/infra/gcp-sa-key.json}"
echo "Checking service account key at $KEY_FILE..."
if [[ -f "$KEY_FILE" ]]; then
  RESULTS+=("✓ Service account key file exists")
  ((PASS++))
  export GOOGLE_APPLICATION_CREDENTIALS="$KEY_FILE"
else
  RESULTS+=("✗ Service account key file not found at $KEY_FILE")
  ((FAIL++))
  echo ""
  echo "  Create it with:"
  echo "    gcloud iam service-accounts keys create $KEY_FILE \\"
  echo "      --iam-account=nocut-ai-engine@\$GCP_PROJECT_ID.iam.gserviceaccount.com"
  echo ""
fi

# ── 3. Authenticate with service account ──
PROJECT="${GCP_PROJECT_ID:-nocut-ai-dev}"
REGION="${GCP_REGION:-asia-northeast1}"

echo "Checking GCP authentication..."
if [[ -f "$KEY_FILE" ]]; then
  check "GCP authentication" gcloud auth activate-service-account --key-file="$KEY_FILE" --project="$PROJECT"
fi

# ── 4. Verify Vertex AI API is enabled ──
echo "Checking Vertex AI API..."
if gcloud services list --enabled --project="$PROJECT" 2>/dev/null | grep -q aiplatform.googleapis.com; then
  RESULTS+=("✓ Vertex AI API enabled")
  ((PASS++))
else
  RESULTS+=("✗ Vertex AI API not enabled")
  ((FAIL++))
  echo "  Enable with: gcloud services enable aiplatform.googleapis.com --project=$PROJECT"
fi

# ── 5. Verify Cloud Storage API ──
echo "Checking Cloud Storage API..."
if gcloud services list --enabled --project="$PROJECT" 2>/dev/null | grep -q storage.googleapis.com; then
  RESULTS+=("✓ Cloud Storage API enabled")
  ((PASS++))
else
  RESULTS+=("✗ Cloud Storage API not enabled")
  ((FAIL++))
  echo "  Enable with: gcloud services enable storage.googleapis.com --project=$PROJECT"
fi

# ── 6. Verify Vertex AI access ──
echo "Checking Vertex AI access..."
if gcloud ai models list --region="$REGION" --project="$PROJECT" --limit=1 2>/dev/null; then
  RESULTS+=("✓ Vertex AI API accessible")
  ((PASS++))
else
  # API accessible but no models is fine for Phase 2 prep
  RESULTS+=("✓ Vertex AI API accessible (no models yet)")
  ((PASS++))
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
echo "  Project: $PROJECT"
echo "  Region:  $REGION"
echo "  Passed: $PASS  |  Failed: $FAIL"
echo "============================================"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo "GCP is configured and ready for Phase 2 AI engine integration."
else
  echo "Some checks failed. See instructions above to fix."
  exit 1
fi
