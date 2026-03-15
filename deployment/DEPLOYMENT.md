# Deployment Guide

This document describes how to deploy Gemini Physio Intake Copilot.

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

- Frontend: Browser app using Gemini Live API (audio plus optional video).
- Backend: Lightweight API service deployed to Google Cloud Run.
- Data: Database for transcripts, structured summaries, and session metadata.
- Optional: Secret Manager for API keys and runtime secrets.

## Prerequisites

- Google Cloud project with billing enabled.
- Google Cloud CLI (gcloud) installed and authenticated.
- Docker installed for container builds (or use Cloud Build only).
- Gemini API access configured.
- IAM permissions for Cloud Run, Artifact Registry, Secret Manager, and database services.

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
- sqladmin.googleapis.com (if using Cloud SQL)

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

Store sensitive values in Secret Manager, not in source code.

Suggested secrets:

- GEMINI_API_KEY
- DB_CONNECTION_STRING
- SESSION_SIGNING_KEY

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

## Backend Deployment (Cloud Run)

### 1. Build Container Image

```bash
gcloud builds submit \
  --tag REGION-docker.pkg.dev/$PROJECT_ID/YOUR_REPO/physio-backend:latest \
  --project "$PROJECT_ID"
```

### 2. Deploy to Cloud Run

```bash
gcloud run deploy physio-intake-backend \
  --image REGION-docker.pkg.dev/$PROJECT_ID/YOUR_REPO/physio-backend:latest \
  --region REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest \
  --project "$PROJECT_ID"
```

### 3. Capture Service URL

```bash
gcloud run services describe physio-intake-backend \
  --region REGION \
  --format='value(status.url)' \
  --project "$PROJECT_ID"
```

## Frontend Deployment

The frontend can be hosted using your preferred static hosting approach (for example, Cloud Run static container or Firebase Hosting).

Minimum frontend runtime settings:

- PUBLIC_BACKEND_URL: Cloud Run backend URL
- PUBLIC_GEMINI_MODEL: Gemini model id used for live sessions
- PUBLIC_ENV: dev, staging, or prod

### Option A: Frontend on Cloud Run

1. Build frontend assets.
2. Serve static build via lightweight web server image.
3. Deploy using `gcloud run deploy` similarly to backend.

### Option B: Frontend on Firebase Hosting

1. Install Firebase CLI.
2. Configure hosting target for project.
3. Deploy static build output.

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
- Transcript and summary records are persisted.
- Red flag extraction appears in structured output.
- Logs show no repeated auth or timeout failures.

## Rollback Strategy

- Keep at least one previous stable revision for backend and frontend.
- Roll back by routing traffic to the previous revision.
- Restore previous secret version if config regression is detected.

Cloud Run rollback example:

```bash
gcloud run services update-traffic physio-intake-backend \
  --region REGION \
  --to-revisions PREVIOUS_REVISION=100 \
  --project YOUR_PROJECT_ID
```

## CI/CD Recommendation

Use CI/CD to automate:

- Lint and tests.
- Container build and vulnerability scan.
- Deployment to staging.
- Smoke tests.
- Manual approval gate for production.

## Compliance and Safety Notes

This system should support clinicians and must not be treated as autonomous diagnosis.

For pilot use:

- Show clear decision-support disclaimers.
- Preserve audit trails for generated summaries.
- Validate safety prompts and escalation behavior before production use.

## Quick Commands Reference

```bash
# Set active project
gcloud config set project YOUR_PROJECT_ID

# List Cloud Run services
gcloud run services list --region REGION

# Tail backend logs
gcloud run services logs tail physio-intake-backend --region REGION --project YOUR_PROJECT_ID
```

## Cleanup and Cost Control

Use this section after demos or test deployments to remove resources and avoid unnecessary charges.

### 1. Delete Cloud Run Services

```bash
gcloud run services delete physio-intake-backend \
  --region REGION \
  --project "$PROJECT_ID" \
  --quiet

gcloud run services delete physio-intake-frontend \
  --region REGION \
  --project "$PROJECT_ID" \
  --quiet
```

### 2. Delete Artifact Registry Images or Repository

Delete unneeded images:

```bash
gcloud artifacts docker images list REGION-docker.pkg.dev/$PROJECT_ID/YOUR_REPO --project "$PROJECT_ID"
```

Delete entire repository (only if safe):

```bash
gcloud artifacts repositories delete YOUR_REPO \
  --location REGION \
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
gcloud artifacts repositories list --location REGION --project "$PROJECT_ID"
gcloud secrets list --project "$PROJECT_ID"
```

Expected result: no prototype-specific services, repositories, or secrets remain.
