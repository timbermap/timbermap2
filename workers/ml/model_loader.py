import os
import logging
import numpy as np
import tensorflow as tf
from tensorflow.keras import backend as K
from google.cloud import storage

log = logging.getLogger(__name__)

# ── Cache — lives in module memory across requests on warm instances ──────────
_cache: dict = {}   # {model_id: {"model": ..., "means": ..., "stds": ...}}

GCS_BUCKET = os.getenv("GCS_BUCKET", "timbermap-data")


# ── Custom loss functions required to load the .h5 files ─────────────────────

def jaccard_coef(y_true, y_pred):
    smooth = 1e-12
    intersection = K.sum(y_true * y_pred, axis=[0, -1, -2])
    sum_ = K.sum(y_true + y_pred, axis=[0, -1, -2])
    return K.mean((intersection + smooth) / (sum_ - intersection + smooth))


def jaccard_coef_int(y_true, y_pred):
    smooth = 1e-12
    y_pred_pos = K.round(K.clip(y_pred, 0, 1))
    intersection = K.sum(y_true * y_pred_pos, axis=[0, -1, -2])
    sum_ = K.sum(y_true + y_pred, axis=[0, -1, -2])
    return K.mean((intersection + smooth) / (sum_ - intersection + smooth))


CUSTOM_OBJECTS = {
    "jaccard_coef":     jaccard_coef,
    "jaccard_coef_int": jaccard_coef_int,
}


def _download_artifact(gcs_path: str, local_path: str):
    """Downloads a file from GCS to local /tmp/."""
    client = storage.Client()
    # gcs_path format: "models/{model_id}/weights.h5"
    # bucket is always GCS_BUCKET
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(gcs_path)
    blob.download_to_filename(local_path)
    log.info("Downloaded %s → %s", gcs_path, local_path)


def load_model_artifacts(model_id: str, artifacts: list[dict]) -> dict:
    """
    Loads model .h5 and normalization arrays from GCS.
    Results are cached in module memory — warm Cloud Run instances
    reuse the loaded model across jobs without re-downloading.
    """
    if model_id in _cache:
        log.info("Using cached artifacts for model %s", model_id)
        return _cache[model_id]

    log.info("Loading artifacts for model %s", model_id)
    loaded = {}

    for art in artifacts:
        key      = art["artifact_key"]   # "weights" | "means" | "stds"
        gcs_path = art["gcs_path"]       # "models/{id}/weights.h5"
        ext      = gcs_path.split(".")[-1]
        local    = f"/tmp/model_{model_id}_{key}.{ext}"

        _download_artifact(gcs_path, local)

        if key == "weights":
            log.info("Loading Keras model from %s", local)
            loaded["model"] = tf.keras.models.load_model(
                local, custom_objects=CUSTOM_OBJECTS
            )
            log.info("Keras model loaded successfully")
        elif key == "means":
            loaded["means"] = np.load(local)
            log.info("means shape=%s dtype=%s", loaded["means"].shape, loaded["means"].dtype)
        elif key == "stds":
            loaded["stds"] = np.load(local)
            log.info("stds  shape=%s dtype=%s", loaded["stds"].shape, loaded["stds"].dtype)

    if "model" not in loaded:
        raise ValueError(f"No 'weights' artifact found for model {model_id}")
    if "means" not in loaded or "stds" not in loaded:
        raise ValueError(f"Missing means/stds artifacts for model {model_id}")

    _cache[model_id] = loaded
    return loaded


def clear_cache(model_id: str = None):
    """Force re-load on next request. Called after superadmin re-uploads artifacts."""
    if model_id:
        _cache.pop(model_id, None)
    else:
        _cache.clear()
