# Deployment Guide

This document describes how to deploy Gemini Physio Intake Copilot.

## Current Deployment Target

- Project: `physio-intake-copilot`
- Region: `us-central1`
- Cloud Run service: `physio-intake-copilot`

## Execution Modes

This deployment plan is designed to be both:

- Manual and human-readable: A developer can run each step directly.
- Agent-executable: An AI coding/deployment agent can execute the same steps in order.

To keep the process reliable for both humans and agents:

- Use explicit command blocks with placeholders.
- Keep resource names deterministic.
- Validate each stage before moving to the next stage.

## Project Configuration

Google Cloud project for this prototype:

- PROJECT_ID: physio-intake-copilot

Set it once before running commands:

```bash
PROJECT_ID="physio-intake-copilot"
gcloud config set project "$PROJECT_ID"
```

## Architecture Summary

- Frontend: Browser app with transcript, push-to-talk audio, optional video preview, and clinician summary UI.
- Backend: Node.js and Express API service deployed to Google Cloud Run.
- Containerization: Docker image built from the repository Dockerfile and deployed to Cloud Run.
- Live auth: Backend-minted Gemini Live ephemeral tokens for secure browser Live sessions.
- Secret management: Secret Manager for the long-lived Gemini API key.
- Persistence: Planned next-phase enhancement for transcripts, summaries, and session metadata.

## Prerequisites

- Google Cloud project with billing enabled.
- Google Cloud CLI (gcloud) installed and authenticated.
- Docker installed for container builds (or use Cloud Build only).
- Gemini API access configured.
- IAM permissions for Cloud Run, Artifact Registry, and Secret Manager.
- Optional for planned persistence work: IAM permissions for database or storage services.

### Install Google Cloud CLI

If gcloud is not installed, install it first.

Windows (PowerShell with winget):

```bash
winget install --id Google.CloudSDK --exact --accept-package-agreements --accept-source-agreements
```

macOS (Homebrew):

```bash
brew install --cask google-cloud-sdk
```

Linux (Debian/Ubuntu):

```bash
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install google-cloud-cli
```

Verify installation:

```bash
gcloud --version
```

Authenticate:

```bash
gcloud auth login
```

## Required Services

Enable these services in GCP:

- run.googleapis.com
- artifactregistry.googleapis.com
- cloudbuild.googleapis.com
- secretmanager.googleapis.com
- sqladmin.googleapis.com (optional, only if adding Cloud SQL later)

Example:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  --project "$PROJECT_ID"
```

## Configuration and Secrets

Store sensitive values in Secret Manager (Google Cloud equivalent of key vault), not in source code.

Suggested secrets:

- GEMINI_API_KEY
- DB_CONNECTION_STRING (optional, only for planned persistence)
- SESSION_SIGNING_KEY (optional, if session signing is added later)

Example secret creation:

```bash
echo -n "YOUR_VALUE" | gcloud secrets create GEMINI_API_KEY \
  --data-file=- \
  --project "$PROJECT_ID"
```

If the secret already exists:

```bash
echo -n "NEW_VALUE" | gcloud secrets versions add GEMINI_API_KEY \
  --data-file=- \
  --project "$PROJECT_ID"
```

## Deploy This Repository to Cloud Run (Recommended)

This repository now includes a Cloud Run server (`server.js`) that:

- Serves the UI from `live-session-preview/`
- Uses Secret Manager-injected `GEMINI_API_KEY` on the server side
- Exposes `/api/chat` so browser clients do not store or send API keys
- Exposes `/api/intake-summary` so the UI can request a structured clinician-facing summary at session end
- Exposes `/api/config` so the frontend can load runtime configuration instead of hardcoding models
- Exposes `/api/live/health` so deployments can verify Gemini Live model readiness

Current deployed interaction model:

- Cloud Run serves the UI and runtime config.
- Browser requests `/api/live/token` when starting a session.
- Backend mints a constrained short-lived Gemini Live token using the server-side API key.
- Browser uses that token directly with Gemini Live WebSocket.
- `/api/chat` remains available as a typed fallback path.
- `/api/intake-summary` generates a structured summary from the current transcript.

Runtime parameters are environment-driven. The app reads these variables at startup:

- `GEMINI_MODEL` for server-side text chat
- `GEMINI_LIVE_MODEL` for Live API sessions
- `GEMINI_LIVE_API_VERSION` for Live API version selection
- `GEMINI_LIVE_RESPONSE_MODALITIES` as a comma-separated list, for example `AUDIO`
- `GEMINI_LIVE_INPUT_AUDIO_TRANSCRIPTION` as `true` or `false`
- `GEMINI_LIVE_OUTPUT_AUDIO_TRANSCRIPTION` as `true` or `false`
- `GEMINI_LIVE_VOICE_NAME` for an optional prebuilt voice
- `GEMINI_LIVE_EPHEMERAL_ENABLED` as `true` or `false`
- `GEMINI_LIVE_EPHEMERAL_USES` for how many sessions a token can start
- `GEMINI_LIVE_EPHEMERAL_EXPIRE_MINUTES` for Live session lifetime
- `GEMINI_LIVE_EPHEMERAL_NEW_SESSION_EXPIRE_SECONDS` for how long a token can start a new session

Set deployment variables:

```bash
REGION="us-central1"
REPO="physio-intake-copilot"
SERVICE="physio-intake-copilot"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:latest"
```

Create Artifact Registry repository (run once):

```bash
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Docker images for Gemini Physio Intake Copilot" \
  --project "$PROJECT_ID"
```

Create the Gemini key secret (run once):

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY \
  --data-file=- \
  --project "$PROJECT_ID"
```

If secret already exists, add a new version:

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY \
  --data-file=- \
  --project "$PROJECT_ID"
```

Build and push image with Cloud Build:

```bash
gcloud builds submit --tag "$IMAGE" --project "$PROJECT_ID"
```

Deploy Cloud Run service with Secret Manager binding:

```bash
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars GEMINI_MODEL=gemini-2.5-flash,GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025,GEMINI_LIVE_API_VERSION=v1alpha,GEMINI_LIVE_RESPONSE_MODALITIES=AUDIO,GEMINI_LIVE_INPUT_AUDIO_TRANSCRIPTION=true,GEMINI_LIVE_OUTPUT_AUDIO_TRANSCRIPTION=true,GEMINI_LIVE_EPHEMERAL_ENABLED=true,GEMINI_LIVE_EPHEMERAL_USES=1,GEMINI_LIVE_EPHEMERAL_EXPIRE_MINUTES=30,GEMINI_LIVE_EPHEMERAL_NEW_SESSION_EXPIRE_SECONDS=60 \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --project "$PROJECT_ID"
```

Get service URL:

```bash
gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format='value(status.url)' \
  --project "$PROJECT_ID"
```

Quick smoke tests:

```bash
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)' --project "$PROJECT_ID")"

# Health
curl "$SERVICE_URL/api/health"

# Runtime config
curl "$SERVICE_URL/api/config"

# Gemini Live readiness
curl "$SERVICE_URL/api/live/health"

# Gemini Live ephemeral token
curl -X POST "$SERVICE_URL/api/live/token" \
  -H "Content-Type: application/json" \
  -d '{}'

# Chat
curl -X POST "$SERVICE_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"text":"knee pain when climbing stairs for 2 weeks"}'

# Intake summary
curl -X POST "$SERVICE_URL/api/intake-summary" \
  -H "Content-Type: application/json" \
  -d '{"transcript":[{"role":"patient","text":"I have knee pain going downstairs."}],"movementObserved":false}'
```

## Post-Deployment Live Status Check Script

Run this every time after deployment:

```bash
powershell -ExecutionPolicy Bypass -File ./scripts/post_deploy_live_status_check.ps1 \
  -ProjectId "$PROJECT_ID" \
  -Region "$REGION" \
  -Service "$SERVICE"
```

Expected behavior:

- Exit code 0: deployment is healthy and Gemini response path is working.
- Exit code 1: deployment has an operational issue (health, auth, quota, or model mismatch).

The script checks:

- Cloud Run service URL resolution
- `/` returns the latest live-voice UI markup
- `/styles.css` and `/app.js` return the latest deployed assets
- `/api/health` status and configured models
- `/api/live/health` readiness for the configured Gemini Live model
- `/api/live/token` can mint an ephemeral Live token for browser bootstrap
- `/api/chat` response with a probe prompt
- Error classification hints for 429 quota and 400/401/403 auth or model issues

## Current Deployment

The current prototype is deployed on Google Cloud Run and verified with the post-deploy health check script.

- Project: `physio-intake-copilot`
- Region: `us-central1`
- Service URL: `https://physio-intake-copilot-215911808617.us-central1.run.app`

Verified endpoints:

- `/`
- `/api/health`
- `/api/config`
- `/api/live/health`
- `/api/live/token`
- `/api/chat`

The current post-deploy script validates the live connection and chat paths. Intake summary generation is available through `/api/intake-summary` and can be tested separately with the example curl request above.

## Enable Gemini Live API Session (Test)

### Local Preview Mode

1. Open the preview page and enter your Gemini API key in the Gemini Live Connection card.
2. Keep or update the model. The default local Live model is `gemini-2.5-flash-native-audio-preview-12-2025`.
3. Click `Connect Live API` and confirm the mode changes to `Live API connected`.
4. Click `Start Session`.
5. Press and hold `Hold to Talk` to stream microphone audio, then release to stop sending audio.

### Deployed Cloud Run Mode

1. Open the deployed site.
2. Click `Start Session`.
3. The browser requests a short-lived token from `/api/live/token` and attempts a secure Gemini Live connection automatically.
4. Once connected, `Hold to Talk` becomes active.
5. Press and hold `Hold to Talk` to stream microphone audio, then release to stop sending audio.

Notes:

- Use a restricted API key for local testing only.
- Do not commit API keys to source control.
- The deployed app uses ephemeral tokens instead of exposing a long-lived API key in the browser.
- If Live connection fails, typed turns can still be tested through the backend text path.

## Troubleshooting

### 500 on /api/chat with API_KEY_INVALID

Symptom:

- `/api/health` returns 200
- `/api/chat` returns 500 and logs show `API_KEY_INVALID`

Cause:

- `GEMINI_API_KEY` in Secret Manager is placeholder, revoked, or invalid.

Fix:

```bash
echo -n "YOUR_NEW_VALID_GEMINI_KEY" | gcloud secrets versions add GEMINI_API_KEY \
  --data-file=- \
  --project "$PROJECT_ID"
```

Notes:

- No redeploy required when Cloud Run uses `GEMINI_API_KEY:latest`.
- Wait 20-30 seconds, then re-test `/api/chat`.

### Permission denied on secret during deploy

Grant Secret Accessor to the Cloud Run runtime service account:

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --project "$PROJECT_ID"
```

## Database Setup

Use a database with encrypted transport and storage.

Minimum tables/collections:

- sessions
- transcripts
- structured_summaries
- audit_events

Recommended data fields:

- session_id
- clinician_id
- patient_alias_or_id
- started_at
- ended_at
- transcript_chunks
- intake_summary
- red_flags
- next_step_suggestions

## Networking and Security

- Use HTTPS only.
- Restrict CORS to trusted frontend origins.
- Use least-privilege service accounts.
- Rotate secrets regularly.
- Add request validation and rate limits.
- Log access and admin actions.

## Observability

Set up:

- Cloud Logging for request and error logs.
- Error reporting alerts.
- Uptime checks for frontend and backend endpoints.
- Latency and error-rate dashboards.

Track key metrics:

- Session start success rate.
- Live connection drop rate.
- Median intake completion time.
- Summary generation latency.
- Backend 5xx error rate.

## Deployment Verification Checklist

After each deployment, verify:

- Health endpoint returns 200.
- Frontend connects to backend successfully.
- Live audio session starts and receives model responses.
- Summary generation through `/api/intake-summary` returns structured output.
- Red flag extraction appears in generated chat or summary output when relevant.
- Logs show no repeated auth or timeout failures.

## Rollback Strategy

- Keep at least one previous stable Cloud Run revision.
- Roll back by routing traffic to the previous revision.
- Restore previous secret version if config regression is detected.

Cloud Run rollback example:

```bash
gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" \
  --to-revisions PREVIOUS_REVISION=100 \
  --project "$PROJECT_ID"
```

## CI/CD Coverage

The current GitHub Actions pipeline automates:

- Dependency installation with `npm ci`
- Server syntax validation with `node --check server.js`
- Docker image build validation on pull requests
- Docker image build and push to Artifact Registry on pushes to `main`
- Deployment to the Cloud Run production service on pushes to `main`
- Post-deploy smoke checks for `/api/health` and `/api/live/health`

Not yet implemented in the current workflow:

- Unit or integration tests beyond syntax validation
- Vulnerability scanning
- Separate staging environment
- Manual approval gates for production

## GitHub Actions CI/CD (Implemented)

This repository now includes a GitHub Actions pipeline at:

- `.github/workflows/gcp-cloud-run-cicd.yml`

Pipeline behavior:

- Manual dispatch: run the full CI and deployment workflow on demand
- Pull requests to `main` or `master`: run CI checks (`npm ci`, `node --check`, Docker build validation)
- Pushes to `main` or `master`: run CI, then build and push a Docker image to Artifact Registry, deploy to Cloud Run, and run smoke checks

### Required GitHub Repository Variables

Set these in GitHub: `Settings` -> `Secrets and variables` -> `Actions` -> `Variables`.

- `GCP_PROJECT_ID` (required) for example `physio-intake-copilot`
- `GCP_REGION` (optional, defaults to `us-central1`)
- `ARTIFACT_REPO` (optional, defaults to `physio-intake-copilot`)
- `CLOUD_RUN_SERVICE` (optional, defaults to `physio-intake-copilot`)

### Required GitHub Repository Secrets

Set these in GitHub: `Settings` -> `Secrets and variables` -> `Actions` -> `Secrets`.

- `GCP_WORKLOAD_IDENTITY_PROVIDER` in this format:
  `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID`
- `GCP_SERVICE_ACCOUNT_EMAIL` for example:
  `github-deployer@physio-intake-copilot.iam.gserviceaccount.com`

### One-Time GCP Setup for Secure GitHub OIDC Auth

Use Workload Identity Federation so GitHub can deploy without storing a static JSON key.

```bash
PROJECT_ID="physio-intake-copilot"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
GITHUB_REPO="YOUR_GITHUB_ORG_OR_USER/YOUR_REPOSITORY"
DEPLOYER_SA="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"

# Create deployer service account
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions Cloud Run Deployer" \
  --project "$PROJECT_ID"

# Minimum deploy permissions
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER_SA" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER_SA" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER_SA" \
  --role="roles/iam.serviceAccountUser"

# Needed so deployer can bind secret refs during deploy
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER_SA" \
  --role="roles/secretmanager.secretAccessor"

# Create workload identity pool and provider
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub OIDC Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"

# Allow only this GitHub repo to impersonate deployer SA
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$GITHUB_REPO"
```

After setup, configure GitHub secrets:

- `GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/providers/$PROVIDER_ID`
- `GCP_SERVICE_ACCOUNT_EMAIL=$DEPLOYER_SA`

## Compliance and Safety Notes

This system should support clinicians and must not be treated as autonomous diagnosis.

For pilot use:

- Show clear decision-support disclaimers.
- Preserve audit trails for generated summaries.
- Validate safety prompts and escalation behavior before production use.

## Quick Commands Reference

```bash
# Set active project
gcloud config set project "$PROJECT_ID"

# List Cloud Run services
gcloud run services list --region "$REGION"

# Tail backend logs
gcloud run services logs tail "$SERVICE" --region "$REGION" --project "$PROJECT_ID"
```

## Cleanup and Cost Control

Use this section after demos or test deployments to remove resources and avoid unnecessary charges.

### 1. Delete Cloud Run Services

```bash
gcloud run services delete "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --quiet
```

### 2. Delete Artifact Registry Images or Repository

Delete unneeded images:

```bash
gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO" --project "$PROJECT_ID"
```

Delete entire repository (only if safe):

```bash
gcloud artifacts repositories delete "$REPO" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --quiet
```

### 3. Delete Secrets Created for the Prototype

```bash
gcloud secrets delete GEMINI_API_KEY --project "$PROJECT_ID" --quiet
gcloud secrets delete DB_CONNECTION_STRING --project "$PROJECT_ID" --quiet
gcloud secrets delete SESSION_SIGNING_KEY --project "$PROJECT_ID" --quiet
```

### 4. Remove Database Resources (If Dedicated to Prototype)

If using Cloud SQL and this instance is only for the prototype:

```bash
gcloud sql instances delete YOUR_SQL_INSTANCE \
  --project "$PROJECT_ID" \
  --quiet
```

### 5. Disable Unused Services (Optional)

Disable services only if the project is not actively used by other apps:

```bash
gcloud services disable run.googleapis.com --project "$PROJECT_ID"
gcloud services disable artifactregistry.googleapis.com --project "$PROJECT_ID"
gcloud services disable cloudbuild.googleapis.com --project "$PROJECT_ID"
gcloud services disable secretmanager.googleapis.com --project "$PROJECT_ID"
```

### 6. Verify Cleanup

```bash
gcloud run services list --region REGION --project "$PROJECT_ID"
gcloud artifacts repositories list --location "$REGION" --project "$PROJECT_ID"
gcloud secrets list --project "$PROJECT_ID"
```

Expected result: no prototype-specific services, repositories, or secrets remain.
