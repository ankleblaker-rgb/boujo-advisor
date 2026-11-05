#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID='farm-ai-system'
REPO='ankleblaker-rgb/boujo-advisor'
POOL='boujo-github'
SA='famic-updater'
gcloud config set project "$PROJECT_ID"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
IDENTIFIERS=$(python3 - <<'PY'
import urllib.request,json
with urllib.request.urlopen('https://api.github.com/repos/ankleblaker-rgb/boujo-advisor',timeout=30) as r:d=json.load(r)
print(str(d['id'])+' '+str(d['owner']['id']))
PY
)
read -r REPO_ID OWNER_ID <<< "$IDENTIFIERS"
SA_EMAIL="$SA@$PROJECT_ID.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA" --display-name='FAMIC lookup updater' --project="$PROJECT_ID"
fi
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name='Boujo GitHub' --project="$PROJECT_ID"
fi
CONDITION="assertion.repository_id == '$REPO_ID' && assertion.repository_owner_id == '$OWNER_ID' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$REPO/.github/workflows/famic-update.yml@refs/heads/main'"
if gcloud iam workload-identity-pools providers describe github --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc github --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc github --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' --attribute-condition="$CONDITION"
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA_EMAIL" --role=roles/datastore.user --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PROJECT_ID" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/$REPO_ID" >/dev/null
printf 'FAMIC_WIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/github\n' "$PROJECT_NUMBER" "$POOL"
printf 'FAMIC_SERVICE_ACCOUNT=%s\n' "$SA_EMAIL"
