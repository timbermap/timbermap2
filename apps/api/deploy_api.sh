#!/bin/bash
# ============================================================
# deploy_api.sh — Build y deploy del API principal
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
SERVICE="timbermap-api"
IMAGE="gcr.io/${PROJECT}/api"

RASTER_WORKER_URL="https://timbermap-raster-worker-tjrp7tcqaa-uc.a.run.app"
ML_WORKER_URL="https://timbermap-ml-worker-tjrp7tcqaa-uc.a.run.app"
VECTOR_WORKER_URL="https://timbermap-vector-worker-tjrp7tcqaa-uc.a.run.app"
CLEANUP_WORKER_URL="https://timbermap-cleanup-worker-tjrp7tcqaa-uc.a.run.app"
API_PUBLIC_URL="https://timbermap-api-tjrp7tcqaa-uc.a.run.app"

echo "========================================"
echo "TIMBERMAP — Deploy API"
echo "========================================"

echo ""
echo "→ Building imagen Docker..."
gcloud builds submit \
  --tag ${IMAGE} \
  --region ${REGION} \
  --timeout 600s \
  .

echo ""
echo "→ Deploying a Cloud Run..."
gcloud run deploy ${SERVICE} \
  --image ${IMAGE} \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --add-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCP_PROJECT=${PROJECT},GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432,RASTER_WORKER_URL=${RASTER_WORKER_URL},ML_WORKER_URL=${ML_WORKER_URL},VECTOR_WORKER_URL=${VECTOR_WORKER_URL},CLEANUP_WORKER_URL=${CLEANUP_WORKER_URL},API_PUBLIC_URL=${API_PUBLIC_URL}" \
  --update-secrets="DB_PASSWORD=pg-password:latest,CLERK_SECRET_KEY=clerk-secret-key:latest,CLERK_WEBHOOK_SECRET=clerk-webhook-secret:latest,RESEND_API_KEY=resend-api-key:latest,CLEANUP_INTERNAL_SECRET=cleanup-internal-secret:latest"

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo "URL: ${API_PUBLIC_URL}"
echo "========================================"
