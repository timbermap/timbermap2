#!/bin/bash
# ============================================================
# deploy_cleanup_worker.sh — Build y deploy del Cleanup Worker
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
SERVICE="timbermap-cleanup-worker"
IMAGE="gcr.io/${PROJECT}/cleanup-worker"

echo "========================================"
echo "TIMBERMAP — Deploy Cleanup Worker"
echo "========================================"

echo ""
echo "→ Building imagen Docker..."
gcloud builds submit \
  --tag ${IMAGE} \
  --region ${REGION} \
  --timeout 300s \
  .

echo ""
echo "→ Deploying a Cloud Run..."
gcloud run deploy ${SERVICE} \
  --image ${IMAGE} \
  --region ${REGION} \
  --platform managed \
  --no-allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 10 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 3 \
  --add-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432" \
  --update-secrets="DB_PASSWORD=pg-password:latest,CLEANUP_INTERNAL_SECRET=cleanup-internal-secret:latest"

# Este worker borra datos de forma irreversible — se mantiene privado
# (--no-allow-unauthenticated) y protegido además por CLEANUP_INTERNAL_SECRET,
# que debe coincidir con el que usa la API al llamarlo (ver deploy_api.sh).
# No se otorga acceso público (allUsers) a este servicio.

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo "========================================"
