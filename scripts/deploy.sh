#!/usr/bin/env bash
# Deploy PlantMemory to Cloud Run with Firestore vector search.
#
#   scripts/deploy.sh [--project ID] [--region REGION] [--seed] [--deploy-only] [--yes]
#
# Safe to re-run: every step checks what exists first. Nothing secret is stored in the
# image or on the service; it runs as a dedicated service account with only the roles
# it needs. Asks for confirmation before creating anything unless --yes is passed.
# --deploy-only skips setup and only builds and deploys new code (what GitHub Actions runs).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-plantmemory}"
SEED=false
DEPLOY_ONLY=false
ASSUME_YES=false
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"
GEMINI_FALLBACK_MODEL="${GEMINI_FALLBACK_MODEL:-gemini-3.5-flash-lite}"
LIVE_MODEL="${LIVE_MODEL:-gemini-3.8-live}"
LIVE_LOCATION="${LIVE_LOCATION:-us-central1}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-gemini-embedding-2}"
EMBEDDING_DIM="${EMBEDDING_DIM:-768}"
COLLECTION="${FIRESTORE_COLLECTION:-incidents}"
MAX_INSTANCES="${MAX_INSTANCES:-3}"
# Google Analytics 4 id ("G-..."), from a Firebase web app or GA4 property. Optional.
ANALYTICS_MEASUREMENT_ID="${ANALYTICS_MEASUREMENT_ID:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --seed) SEED=true; shift ;;
    --deploy-only) DEPLOY_ONLY=true; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  read -r -p "Google Cloud project ID: " PROJECT_ID
fi
[[ -n "$PROJECT_ID" ]] || { echo "A project ID is required." >&2; exit 2; }

cd "$(dirname "$0")/.."
gc() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

RUN_SA="plantmemory-run@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="plantmemory-build@${PROJECT_ID}.iam.gserviceaccount.com"

setup() {
  ACCOUNT="$(gcloud config get account 2>/dev/null)"
  PROJECT_NUMBER="$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')"

  cat <<EOF

Deploying PlantMemory
  gcloud account   $ACCOUNT
  project          $PROJECT_ID ($PROJECT_NUMBER)
  region           $REGION
  service          $SERVICE (public URL, max $MAX_INSTANCES instances, scales to zero)

This enables APIs and creates (if missing):
  - Firestore database "(default)" in $REGION, Native mode, Standard edition
  - 3 Firestore indexes on "$COLLECTION" (vector search, filtered vector search, list by date)
  - 1 Firestore vector index on "manual_sections" (equipment manual search)
  - service account $RUN_SA  (roles: datastore.user, aiplatform.user)
  - service account $BUILD_SA  (role: run.builder)
  - Artifact Registry repo "cloud-run-source-deploy" in $REGION (holds the image)
  - Cloud Run service "$SERVICE", built from source by Cloud Build
EOF
  $SEED && echo "  - then loads the real past repairs and the stand-in manuals, alarm codes, parts and figures into
      Firestore (replacing any there; repair guides are kept)"

  if ! $ASSUME_YES; then
    read -r -p $'\nContinue? [y/N] ' answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Cancelled."; exit 1; }
  fi

  step "Enabling APIs"
  gc services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com firestore.googleapis.com aiplatform.googleapis.com \
    iam.googleapis.com

  step "Firestore database"
  if gc firestore databases describe --database="(default)" >/dev/null 2>&1; then
    echo "exists"
  else
    gc firestore databases create --database="(default)" --location="$REGION" \
      --type=firestore-native --edition=standard
  fi

  step "Firestore indexes"
  create_index() {
    local out group="${INDEX_GROUP:-$COLLECTION}"
    if out="$(gc firestore indexes composite create --collection-group="$group" \
        --query-scope=COLLECTION "$@" --async 2>&1)"; then
      echo "requested"
    elif grep -qi "already exists" <<<"$out"; then
      echo "exists"
    else
      echo "$out" >&2
      return 1
    fi
  }
  VECTOR="vector-config={\"dimension\":\"$EMBEDDING_DIM\",\"flat\":\"{}\"},field-path=embedding"
  create_index --field-config="$VECTOR"
  create_index --field-config=order=ASCENDING,field-path=industry --field-config="$VECTOR"
  create_index --field-config=order=ASCENDING,field-path=industry \
    --field-config=order=DESCENDING,field-path=date
  INDEX_GROUP=manual_sections create_index --field-config="$VECTOR"

  step "Service accounts"
  ensure_sa() {
    local name="$1" title="$2"
    gc iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 \
      || gc iam service-accounts create "$name" --display-name="$title"
  }
  grant() {
    gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" \
      --role="$2" --condition=None --format=none
    echo "  $1 -> $2"
  }
  ensure_sa plantmemory-run "PlantMemory Cloud Run runtime"
  ensure_sa plantmemory-build "PlantMemory Cloud Build"
  grant "$RUN_SA" roles/datastore.user
  grant "$RUN_SA" roles/aiplatform.user
  grant "$BUILD_SA" roles/run.builder

  if $SEED; then
    step "Seeding Firestore with the real past repairs"
    STORE_BACKEND=firestore GOOGLE_CLOUD_PROJECT="$PROJECT_ID" uv run python -m scripts.seed --reset
    step "Seeding Firestore with stand-in manuals, alarm codes, parts and figures"
    STORE_BACKEND=firestore GOOGLE_CLOUD_PROJECT="$PROJECT_ID" uv run python -m scripts.seed_kb --reset
  fi
}

if $DEPLOY_ONLY; then
  step "Deploy only: skipping setup and seeding"
else
  setup
fi

step "Building and deploying to Cloud Run (takes a few minutes)"
# Only a full run makes the service public: that needs IAM rights the GitHub deployer
# doesn't have, and the policy set then stays in place on every later deploy.
gc run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$RUN_SA" \
  --build-service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  $($DEPLOY_ONLY || echo --allow-unauthenticated) \
  --min-instances 0 --max-instances "$MAX_INSTANCES" \
  --cpu 1 --memory 1Gi --concurrency 20 --timeout 600 --cpu-boost \
  --set-env-vars "^@^GOOGLE_GENAI_USE_ENTERPRISE=True@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@GOOGLE_CLOUD_LOCATION=global@GEMINI_MODEL=${GEMINI_MODEL}@GEMINI_FALLBACK_MODEL=${GEMINI_FALLBACK_MODEL}@LIVE_MODEL=${LIVE_MODEL}@LIVE_LOCATION=${LIVE_LOCATION}@EMBEDDING_MODEL=${EMBEDDING_MODEL}@EMBEDDING_DIM=${EMBEDDING_DIM}@STORE_BACKEND=firestore@FIRESTORE_COLLECTION=${COLLECTION}@MATCH_THRESHOLD=0.70@AI_REQUESTS_PER_HOUR=${AI_REQUESTS_PER_HOUR:-300}@ANALYTICS_MEASUREMENT_ID=${ANALYTICS_MEASUREMENT_ID:-}"

URL="$(gc run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
step "Checking $URL"
curl -fsS "$URL/health" && echo
echo "Done: $URL"
# GitHub Actions shows this URL on the deployment.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "url=$URL" >>"$GITHUB_OUTPUT"; fi
