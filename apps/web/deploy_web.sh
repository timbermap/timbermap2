#!/bin/bash
# ============================================================
# deploy_web.sh — Build y deploy del Frontend (Next.js)
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
SERVICE="timbermap-web"
IMAGE="gcr.io/${PROJECT}/web"

echo "========================================"
echo "TIMBERMAP — Deploy Frontend (Next.js)"
echo "========================================"

echo ""
echo "→ Building imagen Docker..."
gcloud builds submit \
  --tag ${IMAGE} \
  --region ${REGION} \
  --timeout 900s \
  .

echo ""
echo "→ Deploying a Cloud Run..."
gcloud run deploy ${SERVICE} \
  --image ${IMAGE} \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars "NEXT_PUBLIC_API_URL=https://timbermap-api-tjrp7tcqaa-uc.a.run.app,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YWRhcHRpbmctbWFjYXctNDYuY2xlcmsuYWNjb3VudHMuZGV2JA,NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in,NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up,NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard,NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard" \
  --update-secrets="CLERK_SECRET_KEY=clerk-secret-key:latest"

WEB_URL=$(gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --format='value(status.url)')

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo "URL: ${WEB_URL}"
echo "========================================"
