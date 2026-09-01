#!/bin/bash
# ============================================================
# deploy_raster_ingest_job.sh — Build y deploy del Cloud Run Job
# Solo necesita correrse cuando hay cambios en el código.
# La API ejecuta una instancia del job por cada imagen subida.
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
JOB_NAME="timbermap-raster-ingest"
IMAGE="gcr.io/${PROJECT}/raster-ingest-job"

echo "========================================"
echo "TIMBERMAP — Deploy Raster Ingest Job"
echo "========================================"

echo ""
echo "→ Building imagen Docker..."
gcloud builds submit \
  --config cloudbuild-job.yaml \
  --region ${REGION} \
  --timeout 600s \
  .

echo ""
echo "→ Creando/actualizando Cloud Run Job..."
gcloud run jobs update ${JOB_NAME} \
  --image ${IMAGE} \
  --region ${REGION} \
  --memory 16Gi \
  --cpu 8 \
  --task-timeout 86400 \
  --max-retries 0 \
  --execution-environment gen2 \
  --set-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCP_PROJECT=${PROJECT},GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432" \
  --update-secrets="DB_PASSWORD=pg-password:latest" \
  2>/dev/null || \
gcloud run jobs create ${JOB_NAME} \
  --image ${IMAGE} \
  --region ${REGION} \
  --memory 16Gi \
  --cpu 8 \
  --task-timeout 86400 \
  --max-retries 0 \
  --execution-environment gen2 \
  --set-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCP_PROJECT=${PROJECT},GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432" \
  --update-secrets="DB_PASSWORD=pg-password:latest"

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo "Job: ${JOB_NAME}"
echo "========================================"
