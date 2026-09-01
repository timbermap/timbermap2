#!/bin/bash
# ============================================================
# deploy_all.sh — Deploy completo de todos los servicios
# Orden: API → Raster Worker → ML Worker → Web
# ============================================================
set -e

PROJECT="timbermap-prod"
REGION="us-central1"
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "TIMBERMAP — Deploy Completo"
echo "========================================"

# ── 1. API ────────────────────────────────────────────────────
echo ""
echo "[1/4] API..."
cd "${ROOT}/apps/api"
bash deploy_api.sh

API_URL=$(gcloud run services describe timbermap-api \
  --region ${REGION} --format='value(status.url)')

# ── 2. Cleanup Worker ─────────────────────────────────────────
echo ""
echo "[2/6] Cleanup Worker..."
cd "${ROOT}/workers/cleanup"
bash deploy_cleanup_worker.sh

# ── 3. Raster Worker ──────────────────────────────────────────
echo ""
echo "[3/6] Raster Worker..."
cd "${ROOT}/workers/raster"
bash deploy_raster_worker.sh

RASTER_URL=$(gcloud run services describe timbermap-raster-worker \
  --region ${REGION} --format='value(status.url)')

# ── 3. ML Worker ──────────────────────────────────────────────
echo ""
echo "[4/6] ML Worker..."
cd "${ROOT}/workers/ml"
bash deploy_ml_worker.sh

ML_URL=$(gcloud run services describe timbermap-ml-worker \
  --region ${REGION} --format='value(status.url)')

# ── 5. Actualizar env vars en API ────────────────────────────
echo ""
echo "[5/6] Actualizando env vars en API..."
gcloud run services update timbermap-api \
  --region ${REGION} \
  --update-env-vars "RASTER_WORKER_URL=${RASTER_URL},ML_WORKER_URL=${ML_URL},API_PUBLIC_URL=${API_URL}"

# ── 6. Frontend ───────────────────────────────────────────────
echo ""
echo "[6/6] Frontend (Next.js)..."
cd "${ROOT}/apps/web"
bash deploy_web.sh

WEB_URL=$(gcloud run services describe timbermap-web \
  --region ${REGION} --format='value(status.url)')

echo ""
echo "========================================"
echo "Deploy completo ✓"
echo ""
echo "Web:            ${WEB_URL}"
echo "API:            ${API_URL}"
echo "Raster Worker:  ${RASTER_URL}"
echo "ML Worker:      ${ML_URL}"
echo "========================================"
