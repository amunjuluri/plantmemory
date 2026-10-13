#!/usr/bin/env bash
# Let GitHub Actions deploy PlantMemory to Cloud Run after each merge to main.
#
#   scripts/setup_github_deploy.sh [--project ID] [--region REGION] [--repo OWNER/NAME] [--yes]
#
# Run once, after scripts/deploy.sh has set the project up. No keys are created: GitHub
# signs in through Workload Identity Federation, and only workflows running on this
# repo's main branch may act as the deployer. Safe to re-run.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-}"
POOL=github
PROVIDER=plantmemory
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || { echo "--project is required." >&2; exit 2; }
REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

gc() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

PROJECT_NUMBER="$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOY_SA="plantmemory-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_SA="plantmemory-run@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="plantmemory-build@${PROJECT_ID}.iam.gserviceaccount.com"
SOURCE_BUCKET="run-sources-${PROJECT_ID}-${REGION}"
POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"

cat <<EOF

GitHub deploys for $REPO
  project   $PROJECT_ID ($PROJECT_NUMBER), region $REGION

This creates (if missing):
  - Workload Identity pool "$POOL" and provider "$PROVIDER", trusting only
    $REPO on refs/heads/main
  - service account $DEPLOY_SA, allowed to deploy new revisions
    of Cloud Run in $PROJECT_ID (run.developer, cloudbuild.builds.editor; acts as the
    run and build service accounts; writes to the source bucket)
  - GitHub environment "production" (deploys from main only) with the variables the
    workflow reads
EOF

if ! $ASSUME_YES; then
  read -r -p $'\nContinue? [y/N] ' answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Cancelled."; exit 1; }
fi

step "Enabling APIs"
gc services enable iamcredentials.googleapis.com sts.googleapis.com

step "Workload Identity Federation"
gc iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || gc iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions"
gc iam workload-identity-pools providers describe "$PROVIDER" --location=global \
    --workload-identity-pool="$POOL" >/dev/null 2>&1 \
  || gc iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global \
    --workload-identity-pool="$POOL" --display-name="$REPO" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/main'"
echo "ok"

step "Deployer service account"
gc iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 \
  || gc iam service-accounts create plantmemory-deploy --display-name="PlantMemory GitHub deployer"
for role in roles/run.developer roles/cloudbuild.builds.editor \
    roles/serviceusage.serviceUsageConsumer; do
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" \
    --role="$role" --condition=None --format=none
  echo "  $DEPLOY_SA -> $role"
done
for sa in "$RUN_SA" "$BUILD_SA"; do
  gc iam service-accounts add-iam-policy-binding "$sa" --member="serviceAccount:$DEPLOY_SA" \
    --role=roles/iam.serviceAccountUser --format=none
  echo "  $DEPLOY_SA -> serviceAccountUser on $sa"
done
gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" --project "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/storage.admin --format=none
echo "  $DEPLOY_SA -> storage.admin on gs://${SOURCE_BUCKET}"
gc artifacts repositories add-iam-policy-binding cloud-run-source-deploy --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.reader --format=none
echo "  $DEPLOY_SA -> artifactregistry.reader on cloud-run-source-deploy"
gc iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${REPO}" \
  --role=roles/iam.workloadIdentityUser --format=none
echo "  $REPO may act as $DEPLOY_SA"

step "GitHub environment \"production\""
gh api -X PUT "repos/${REPO}/environments/production" --silent \
  -F "deployment_branch_policy[protected_branches]=true" \
  -F "deployment_branch_policy[custom_branch_policies]=false"
gh variable set GCP_PROJECT_ID --repo "$REPO" --env production --body "$PROJECT_ID"
gh variable set GCP_REGION --repo "$REPO" --env production --body "$REGION"
gh variable set GCP_DEPLOY_SA --repo "$REPO" --env production --body "$DEPLOY_SA"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" --env production \
  --body "${POOL_ID}/providers/${PROVIDER}"
echo "Done: merges to main now deploy and show under Deployments on GitHub."
