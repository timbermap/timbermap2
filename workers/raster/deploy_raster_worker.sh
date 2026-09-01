#!/bin/bash
# ============================================================
# deploy_raster_worker.sh — Build y deploy del Raster Worker
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
SERVICE="timbermap-raster-worker"
IMAGE="gcr.io/${PROJECT}/raster-worker"

echo "========================================"
echo "TIMBERMAP — Deploy Raster Worker"
echo "========================================"

# Crear queues (idempotente)
echo ""
echo "→ Creando queues..."
gcloud tasks queues create raster-ingest \
  --location=${REGION} \
  --project=${PROJECT} \
  2>/dev/null || echo "  Queue raster-ingest ya existe, ok"

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
  --memory 8Gi \
  --cpu 4 \
  --concurrency 1 \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 3 \
  --execution-environment gen2 \
  --add-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCP_PROJECT=${PROJECT},GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432" \
  --update-secrets="DB_PASSWORD=pg-password:latest"

RASTER_URL=$(gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --format='value(status.url)')

# Allow Cloud Tasks to invoke (no OIDC token configured in tasks.py)
echo ""
echo "→ Configurando IAM..."
gcloud run services add-iam-policy-binding ${SERVICE} \
  --region ${REGION} \
  --member="allUsers" \
  --role="roles/run.invoker"

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo "URL: ${RASTER_URL}"
echo ""
echo "Actualizar RASTER_WORKER_URL en la API:"
echo ""
echo "  gcloud run services update timbermap-api \\"
echo "    --region ${REGION} \\"
echo "    --update-env-vars RASTER_WORKER_URL=${RASTER_URL}"
echo "========================================"
