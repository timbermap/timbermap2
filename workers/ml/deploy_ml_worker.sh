#!/bin/bash
# ============================================================
# deploy_ml_worker.sh
# Build y deploy del ML Worker — configuración económica:
#   16 GB RAM / 4 CPU / max-instances 1 / min-instances 0
#   Costo ~$0.25/job (30 min imagen 2GB)
#   Escala a cero cuando no hay jobs → costo cero en reposo
# ============================================================

set -e

PROJECT="timbermap-prod"
REGION="us-central1"
SERVICE="timbermap-ml-worker"
IMAGE="gcr.io/${PROJECT}/ml-worker"

echo "========================================"
echo "TIMBERMAP — Deploy ML Worker (económico)"
echo "========================================"

# Crear queue ml-inference (idempotente)
echo ""
echo "→ Creando queue ml-inference..."
gcloud tasks queues create ml-inference \
  --location=${REGION} \
  --project=${PROJECT} \
  2>/dev/null || echo "  Queue ya existe, ok"

# Build imagen
echo ""
echo "→ Building imagen Docker (~10 min primera vez)..."
gcloud builds submit \
  --tag ${IMAGE} \
  --timeout 1200s \
  .

# Deploy
echo ""
echo "→ Deploying a Cloud Run..."
gcloud run deploy ${SERVICE} \
  --image ${IMAGE} \
  --region ${REGION} \
  --platform managed \
  --no-allow-unauthenticated \
  --port 8080 \
  --memory 16Gi \
  --cpu 4 \
  --concurrency 1 \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 1 \
  --add-cloudsql-instances ${PROJECT}:${REGION}:timbermap-db \
  --set-env-vars "GCP_PROJECT=${PROJECT},GCS_BUCKET=timbermap-data,DB_HOST=/cloudsql/${PROJECT}:${REGION}:timbermap-db,DB_NAME=timbermap,DB_USER=postgres,DB_PORT=5432" \
  --update-secrets="DB_PASSWORD=pg-password:latest"

# Obtener URL
ML_WORKER_URL=$(gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --format='value(status.url)')

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo ""
echo "URL: ${ML_WORKER_URL}"
echo ""
echo "Agregar ML_WORKER_URL a la API:"
echo ""
echo "  gcloud run services update timbermap-api \\"
echo "    --region ${REGION} \\"
echo "    --update-env-vars ML_WORKER_URL=${ML_WORKER_URL}"
echo ""
echo "Si necesitás más potencia para imágenes grandes:"
echo "  gcloud run services update ${SERVICE} \\"
echo "    --region ${REGION} \\"
echo "    --memory 32Gi --cpu 8"
echo "========================================"
