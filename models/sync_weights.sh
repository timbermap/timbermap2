#!/bin/bash
# ============================================================
# sync_weights.sh — push/pull a model's 02_weights/ to/from GCS
# Usage: ./sync_weights.sh push|pull <model_folder>
#   e.g. ./sync_weights.sh pull 001_conteo_copas
# ============================================================
set -e

BUCKET="timbermap-data"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CMD="$1"
FOLDER="$2"

if [[ "$CMD" != "push" && "$CMD" != "pull" ]] || [[ -z "$FOLDER" ]]; then
  echo "Usage: $0 push|pull <model_folder>"
  echo "  e.g. $0 pull 001_conteo_copas"
  exit 1
fi

MODEL_JSON="$DIR/$FOLDER/model.json"
if [[ ! -f "$MODEL_JSON" ]]; then
  echo "No model.json found at $MODEL_JSON"
  exit 1
fi

PREFIX=$(python3 -c "import json; print(json.load(open('$MODEL_JSON'))['gcs_weights_prefix'])")
LOCAL_DIR="$DIR/$FOLDER/02_weights"
GCS_PATH="gs://$BUCKET/$PREFIX"

if [[ "$CMD" == "pull" ]]; then
  echo "→ Pulling $GCS_PATH → $LOCAL_DIR"
  gsutil -m rsync -r "$GCS_PATH" "$LOCAL_DIR"
else
  echo "→ Pushing $LOCAL_DIR → $GCS_PATH"
  gsutil -m rsync -r -x '\.gitkeep$' "$LOCAL_DIR" "$GCS_PATH"
fi

echo "Done."
