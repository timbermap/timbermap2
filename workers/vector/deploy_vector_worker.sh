#!/bin/bash
# ============================================================
# deploy_vector_worker.sh — Build y deploy del Vector Worker
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
SERVICE="timbermap-vector-worker"
IMAGE="gcr.io/${PROJECT}/vector-worker"

echo "========================================"
echo "TIMBERMAP — Deploy Vector Worker"
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
  --memory 2Gi \
  --cpu 2 \
  --concurrency 4 \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 5 \
  --add-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCP_PROJECT=${PROJECT},GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432" \
  --update-secrets="DB_PASSWORD=pg-password:latest"

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo "========================================"
