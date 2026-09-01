from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta
import json
import os
import time
import requests as http_requests
import google.auth.transport.requests
import google.oauth2.id_token

import database
from google.cloud import storage

router        = APIRouter(prefix="/superadmin", tags=["superadmin"])
models_router = APIRouter(prefix="/models", tags=["models"])

GCS_BUCKET = os.getenv("GCS_BUCKET", "timbermap-data")
CLEANUP_WORKER_URL = os.getenv("CLEANUP_WORKER_URL", "https://timbermap-cleanup-worker-tjrp7tcqaa-uc.a.run.app")
CLEANUP_INTERNAL_SECRET = os.getenv("CLEANUP_INTERNAL_SECRET")

# Services checked by the System tab. Cloud Run URLs, not app routes — each
# needs its own OIDC identity token now that raster/vector/cleanup are
# locked down to the API's service account (ml-worker was always locked).
MONITORED_SERVICES = {
    "api":             os.getenv("API_PUBLIC_URL", "https://timbermap-api-tjrp7tcqaa-uc.a.run.app"),
    "web":             "https://timbermap-web-788407107542.us-central1.run.app",
    "raster-worker":   os.getenv("RASTER_WORKER_URL", "https://timbermap-raster-worker-tjrp7tcqaa-uc.a.run.app"),
    "vector-worker":   os.getenv("VECTOR_WORKER_URL", "https://timbermap-vector-worker-tjrp7tcqaa-uc.a.run.app"),
    "ml-worker":       os.getenv("ML_WORKER_URL", "https://timbermap-ml-worker-tjrp7tcqaa-uc.a.run.app"),
    "cleanup-worker":  CLEANUP_WORKER_URL,
}
# api/web are public; the rest require an OIDC token to reach /health at all.
PUBLIC_SERVICES = {"api", "web"}
# web has no /health route — checking "/" and accepting redirects is enough
# to know the container is up and serving.
HEALTH_PATHS = {"web": "/"}


def _id_token_headers(audience: str) -> dict:
    try:
        auth_req = google.auth.transport.requests.Request()
        token = google.oauth2.id_token.fetch_id_token(auth_req, audience)
        return {"Authorization": f"Bearer {token}"}
    except Exception:
        return {}


def cleanup_worker_headers() -> dict:
    headers = _id_token_headers(CLEANUP_WORKER_URL)
    if CLEANUP_INTERNAL_SECRET:
        headers["x-internal-secret"] = CLEANUP_INTERNAL_SECRET
    return headers

# ── Auth ──────────────────────────────────────────────────────────────────────

async def require_superadmin(clerk_id: str = Header(..., alias="x-clerk-id")) -> str:
    if not database.get_user_id(clerk_id):
        raise HTTPException(403, "User not found")
    conn = database.get_conn()
    cur  = conn.cursor()
    cur.execute("SELECT is_superadmin FROM users WHERE clerk_id = %s", (clerk_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    if not row or not row["is_superadmin"]:
        raise HTTPException(403, "Superadmin access required")
    return clerk_id

# ── Pydantic ──────────────────────────────────────────────────────────────────

class CreateModelRequest(BaseModel):
    name: str; slug: str; description: str = ""; pipeline_type: str
    version: str = "1.0"; output_types: list = []; inference_config: dict = {}
    phase2_config: dict = {}; worker_type: str = "ml"

class UpdateModelRequest(BaseModel):
    name: Optional[str] = None; description: Optional[str] = None
    version: Optional[str] = None; pipeline_type: Optional[str] = None
    inference_config: Optional[dict] = None; phase2_config: Optional[dict] = None
    output_types: Optional[list] = None; is_active: Optional[bool] = None

class ArtifactConfirmRequest(BaseModel):
    artifact_key: str; gcs_path: str; file_size: int = 0; checksum: str = ""

class GrantModelRequest(BaseModel):
    user_id: str; config_override: Optional[dict] = None; max_runs_month: Optional[int] = None

class SetSuperadminRequest(BaseModel):
    is_superadmin: bool

class SetPlanRequest(BaseModel):
    is_custom: bool

class SetTierLimitRequest(BaseModel):
    storage_limit_gb: Optional[int] = None
    weekly_job_limit: Optional[int] = None

class EditJobRequest(BaseModel):
    status: Optional[str] = None
    message: Optional[str] = None

# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
def superadmin_health(_: str = Depends(require_superadmin)):
    return {"status": "ok", "service": "superadmin"}

# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(_: str = Depends(require_superadmin)):
    return database.superadmin_global_stats()

@router.get("/stats/models")
def get_model_stats(_: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT m.id, m.name, m.slug, m.pipeline_type,
            COUNT(j.id) AS total_jobs,
            COUNT(j.id) FILTER (WHERE j.status='done')    AS done_jobs,
            COUNT(j.id) FILTER (WHERE j.status='failed')  AS failed_jobs,
            COUNT(j.id) FILTER (WHERE j.status='running') AS running_jobs,
            COALESCE(SUM(CASE WHEN j.status='done' THEN
                COALESCE((j.summary->>'area_ha_processed')::float,
                         (j.summary->>'area_ha')::float, i.area_ha, 0)
            ELSE 0 END), 0) AS total_ha_processed
        FROM models m
        LEFT JOIN jobs j ON j.model_id=m.id AND j.type='ml_inference'
        LEFT JOIN images i ON i.id=j.input_image_id
        GROUP BY m.id ORDER BY total_jobs DESC
    """)
    rows = cur.fetchall(); cur.close(); conn.close()
    return {"models": [dict(r) for r in rows]}

@router.get("/stats/users")
def get_user_stats(_: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT u.id, u.email, u.username, u.created_at,
            COUNT(DISTINCT j.id) FILTER (WHERE j.status='done')   AS jobs_done,
            COUNT(DISTINCT j.id) FILTER (WHERE j.status='failed') AS jobs_failed,
            COALESCE(SUM(CASE WHEN j.status='done' THEN
                COALESCE((j.summary->>'area_ha_processed')::float,
                         (j.summary->>'area_ha')::float, i.area_ha, 0)
            ELSE 0 END), 0) AS total_ha_processed,
            COUNT(DISTINCT p.model_id) AS model_count
        FROM users u
        LEFT JOIN jobs j ON j.owner_id=u.id AND j.type='ml_inference'
        LEFT JOIN images i ON i.id=j.input_image_id
        LEFT JOIN user_model_permissions p ON p.user_id=u.id
        GROUP BY u.id ORDER BY total_ha_processed DESC
    """)
    rows = cur.fetchall(); cur.close(); conn.close()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("created_at"): d["created_at"] = d["created_at"].isoformat()
        result.append(d)
    return {"users": result}

# ── Models ────────────────────────────────────────────────────────────────────

@router.get("/models")
def list_models(_: str = Depends(require_superadmin)):
    return {"models": database.superadmin_list_models()}

@router.post("/models")
def create_model(req: CreateModelRequest, _: str = Depends(require_superadmin)):
    try: return database.superadmin_create_model(req.model_dump())
    except Exception as e: raise HTTPException(400, str(e))

@router.get("/models/{model_id}")
def get_model(model_id: str, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT * FROM models WHERE id=%s", (model_id,))
    row = cur.fetchone()
    cur.execute("SELECT * FROM model_artifacts WHERE model_id=%s", (model_id,))
    artifacts = cur.fetchall()
    cur.execute("""
        SELECT u.id, u.email, u.username, p.granted_at, p.max_runs_month
        FROM user_model_permissions p JOIN users u ON u.id=p.user_id
        WHERE p.model_id=%s ORDER BY p.granted_at DESC
    """, (model_id,))
    users = cur.fetchall()
    cur.close(); conn.close()
    if not row: raise HTTPException(404, "Model not found")
    d = dict(row)
    d["artifacts"] = [dict(a) for a in artifacts]
    d["users"] = [dict(u) for u in users]
    for a in d["artifacts"]:
        if a.get("uploaded_at"): a["uploaded_at"] = a["uploaded_at"].isoformat()
    for u in d["users"]:
        if u.get("granted_at"): u["granted_at"] = u["granted_at"].isoformat()
    if d.get("created_at"): d["created_at"] = d["created_at"].isoformat()
    for f in ["inference_config","phase2_config","output_types"]:
        if isinstance(d.get(f), str):
            try: d[f] = json.loads(d[f])
            except: pass
    return d

@router.put("/models/{model_id}")
def update_model(model_id: str, req: UpdateModelRequest, _: str = Depends(require_superadmin)):
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    updated = database.superadmin_update_model(model_id, data)
    if not updated: raise HTTPException(404, "Model not found")
    return updated

@router.delete("/models/{model_id}")
def deactivate_model(model_id: str, _: str = Depends(require_superadmin)):
    ok = database.superadmin_deactivate_model(model_id)
    if not ok: raise HTTPException(404, "Model not found")
    return {"deactivated": True, "model_id": model_id}

# ── Artifacts ─────────────────────────────────────────────────────────────────

@router.get("/models/{model_id}/artifacts")
def list_artifacts(model_id: str, _: str = Depends(require_superadmin)):
    return {"artifacts": database.get_model_artifacts(model_id)}

@router.post("/models/{model_id}/artifacts/upload-url")
def get_artifact_upload_url(model_id: str, artifact_key: str, filename: str,
                             _: str = Depends(require_superadmin)):
    ext      = filename.rsplit(".", 1)[-1] if "." in filename else "bin"
    gcs_path = f"models/{model_id}/{artifact_key}.{ext}"
    url = storage.Client().bucket(GCS_BUCKET).blob(gcs_path).generate_signed_url(
        version="v4", expiration=timedelta(hours=2),
        method="PUT", content_type="application/octet-stream",
    )
    return {"url": url, "gcs_path": gcs_path}

@router.post("/models/{model_id}/artifacts/confirm")
def confirm_artifact(model_id: str, req: ArtifactConfirmRequest, _: str = Depends(require_superadmin)):
    return database.superadmin_upsert_artifact(
        model_id=model_id, artifact_key=req.artifact_key,
        gcs_path=req.gcs_path, file_size=req.file_size, checksum=req.checksum,
    )

@router.delete("/models/{model_id}/artifacts/{artifact_key}")
def delete_artifact(model_id: str, artifact_key: str, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("DELETE FROM model_artifacts WHERE model_id=%s AND artifact_key=%s RETURNING gcs_path",
                (model_id, artifact_key))
    row = cur.fetchone(); conn.commit(); cur.close(); conn.close()
    if not row: raise HTTPException(404, "Artifact not found")
    try: storage.Client().bucket(GCS_BUCKET).blob(row["gcs_path"]).delete()
    except: pass
    return {"deleted": True, "artifact_key": artifact_key}

# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(_: str = Depends(require_superadmin)):
    users = database.superadmin_list_users()
    for u in users:
        if u.get("created_at"): u["created_at"] = u["created_at"].isoformat()
    return {"users": users}

@router.get("/users/{target_clerk_id}")
def get_user(target_clerk_id: str, _: str = Depends(require_superadmin)):
    user = database.superadmin_get_user_detail(target_clerk_id)
    if not user: raise HTTPException(404, "User not found")
    for f in ["created_at"]:
        if user.get(f): user[f] = user[f].isoformat()
    for job in user.get("recent_jobs", []):
        for f in ["created_at","finished_at"]:
            if job.get(f): job[f] = job[f].isoformat()
    for p in user.get("models", []):
        if p.get("granted_at"): p["granted_at"] = p["granted_at"].isoformat()
    return user

@router.post("/users/{target_clerk_id}/models/{model_id}")
def grant_model(target_clerk_id: str, model_id: str, req: GrantModelRequest,
                admin_clerk_id: str = Depends(require_superadmin)):
    database.superadmin_grant_model(
        user_id=req.user_id, model_id=model_id,
        granted_by_clerk_id=admin_clerk_id,
        config_override=req.config_override, max_runs_month=req.max_runs_month,
    )
    return {"granted": True, "user_id": req.user_id, "model_id": model_id}

@router.delete("/users/{target_clerk_id}/models/{model_id}")
def revoke_model(target_clerk_id: str, model_id: str, user_id: str,
                 _: str = Depends(require_superadmin)):
    ok = database.superadmin_revoke_model(user_id=user_id, model_id=model_id)
    if not ok: raise HTTPException(404, "Permission not found")
    return {"revoked": True, "user_id": user_id, "model_id": model_id}

@router.put("/users/{target_clerk_id}/superadmin")
def set_superadmin(target_clerk_id: str, req: SetSuperadminRequest, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("UPDATE users SET is_superadmin=%s WHERE clerk_id=%s RETURNING id",
                (req.is_superadmin, target_clerk_id))
    row = cur.fetchone(); conn.commit(); cur.close(); conn.close()
    if not row: raise HTTPException(404, "User not found")
    return {"updated": True, "clerk_id": target_clerk_id, "is_superadmin": req.is_superadmin}

@router.delete("/users/{target_clerk_id}")
def delete_user_account(target_clerk_id: str, admin_clerk_id: str = Depends(require_superadmin)):
    """Irreversibly deletes a user's account: all images, vectors, jobs, GCS
    files and PostGIS data (via the cleanup worker), then the users row."""
    if target_clerk_id == admin_clerk_id:
        raise HTTPException(400, "Can't delete your own account from here")
    if not database.get_user_id(target_clerk_id):
        raise HTTPException(404, "User not found")
    try:
        r = http_requests.delete(
            f"{CLEANUP_WORKER_URL}/user/{target_clerk_id}",
            headers=cleanup_worker_headers(), timeout=120,
        )
        r.raise_for_status()
    except Exception as e:
        raise HTTPException(500, f"Cleanup worker failed: {e}")
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE clerk_id = %s", (target_clerk_id,))
    conn.commit(); cur.close(); conn.close()
    return {"deleted": True, "clerk_id": target_clerk_id}

@router.put("/users/{target_clerk_id}/plan")
def set_plan(target_clerk_id: str, req: SetPlanRequest, _: str = Depends(require_superadmin)):
    """Tiers: basic (default) and active (has a paid model) are computed automatically
    from model access. 'custom' is the only manually-assigned override."""
    plan = "custom" if req.is_custom else "free"
    ok = database.superadmin_set_plan(target_clerk_id, plan)
    if not ok: raise HTTPException(404, "User not found")
    return {"updated": True, "clerk_id": target_clerk_id, "plan": plan}

@router.get("/tier-limits")
def get_tier_limits(_: str = Depends(require_superadmin)):
    return {"tiers": database.get_tier_limits()}

@router.put("/tier-limits/{tier}")
def set_tier_limit(tier: str, req: SetTierLimitRequest, _: str = Depends(require_superadmin)):
    if tier not in ("basic", "active", "custom"):
        raise HTTPException(400, "Unknown tier")
    ok = database.set_tier_limit(tier, req.storage_limit_gb, req.weekly_job_limit)
    if not ok: raise HTTPException(404, "Tier not found")
    return {"updated": True, "tier": tier}

# ── Jobs (admin) ──────────────────────────────────────────────────────────────

@router.get("/jobs")
def list_all_jobs(status: Optional[str] = None, limit: int = 100,
                  _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    where = "WHERE j.status = %s" if status else ""
    params = (status, limit) if status else (limit,)
    cur.execute(f"""
        SELECT j.id, j.type, j.status, j.message, j.created_at, j.started_at, j.finished_at,
               j.summary, u.email, u.username,
               m.name AS model_name, i.filename AS image_filename, i.area_ha AS image_area_ha,
               COALESCE((j.summary->>'area_ha_processed')::float,
                        (j.summary->>'area_ha')::float, i.area_ha) AS area_ha_processed
        FROM jobs j
        JOIN users u ON u.id=j.owner_id
        LEFT JOIN models m ON m.id=j.model_id
        LEFT JOIN images i ON i.id=j.input_image_id
        {where} ORDER BY j.created_at DESC LIMIT %s
    """, params)
    rows = cur.fetchall(); cur.close(); conn.close()
    result = []
    for r in rows:
        d = dict(r)
        for f in ["created_at","started_at","finished_at"]:
            if d.get(f): d[f] = d[f].isoformat()
        result.append(d)
    return {"jobs": result}

@router.get("/jobs/queue")
def list_queue(_: str = Depends(require_superadmin)):
    jobs = database.superadmin_list_queue()
    for j in jobs:
        for f in ["created_at","started_at"]:
            if j.get(f): j[f] = j[f].isoformat()
    return {"jobs": jobs}

@router.patch("/jobs/{job_id}")
def edit_job(job_id: str, req: EditJobRequest, _: str = Depends(require_superadmin)):
    """Manually edit a stuck job's status/message — for support/debugging,
    not part of the normal job lifecycle."""
    fields, params = [], []
    if req.status is not None:
        fields.append("status = %s"); params.append(req.status)
    if req.message is not None:
        fields.append("message = %s"); params.append(req.message)
    if not fields:
        raise HTTPException(400, "Nothing to update")
    params.append(job_id)
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = %s RETURNING id", params)
    row = cur.fetchone(); conn.commit(); cur.close(); conn.close()
    if not row: raise HTTPException(404, "Job not found")
    return {"updated": True, "job_id": job_id}

@router.delete("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, _: str = Depends(require_superadmin)):
    ok = database.superadmin_cancel_job(job_id)
    if not ok: raise HTTPException(404, "Job not found or already finished")
    return {"cancelled": True, "job_id": job_id}

@router.delete("/jobs/{job_id}")
def hard_delete_job(job_id: str, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT gcs_path FROM job_outputs WHERE job_id=%s", (job_id,))
    paths = [r["gcs_path"] for r in cur.fetchall()]
    cur.execute("DELETE FROM job_outputs WHERE job_id=%s", (job_id,))
    cur.execute("DELETE FROM jobs WHERE id=%s", (job_id,))
    conn.commit(); cur.close(); conn.close()
    client = storage.Client(); bucket = client.bucket(GCS_BUCKET)
    deleted = 0
    for p in paths:
        try: bucket.blob(p).delete(); deleted += 1
        except: pass
    return {"deleted": True, "job_id": job_id, "files_deleted": deleted}

@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: str, _: str = Depends(require_superadmin)):
    """Reset a failed/cancelled/stuck job to queued and re-enqueue it — for
    whatever it actually is, not just model-driven (ML/raster-analysis) jobs."""
    from tasks import (
        enqueue_ml_job, enqueue_raster_analysis,
        enqueue_raster_ingest, enqueue_vector_ingest,
        enqueue_raster_transform, enqueue_vector_transform,
    )
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT j.*, m.type AS model_type, u.clerk_id AS owner_clerk_id
        FROM jobs j
        LEFT JOIN models m ON m.id = j.model_id
        JOIN users u ON u.id = j.owner_id
        WHERE j.id = %s
    """, (job_id,))
    job = cur.fetchone()
    if not job:
        cur.close(); conn.close()
        raise HTTPException(404, "Job not found")
    cur.execute("""
        UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, message=NULL
        WHERE id=%s
    """, (job_id,))
    conn.commit(); cur.close(); conn.close()

    input_ref = job.get("input_ref") or {}
    clerk_id = job["owner_clerk_id"]
    job_type = job["type"]

    if job_type == "raster_ingest":
        enqueue_raster_ingest(
            job_id=job_id, image_id=input_ref.get("image_id"),
            gcs_path=input_ref.get("gcs_path"), filename=input_ref.get("filename"),
            clerk_id=clerk_id,
        )
    elif job_type == "vector_ingest":
        enqueue_vector_ingest(
            job_id=job_id, vector_id=input_ref.get("vector_id"),
            gcs_path=input_ref.get("gcs_path"), filename=input_ref.get("filename"),
        )
    elif job_type == "raster_transform":
        res_m = input_ref.get("new_resolution_x") or input_ref.get("new_resolution_y")
        enqueue_raster_transform(
            job_id=job_id, image_id=input_ref.get("image_id"),
            target_epsg=input_ref.get("new_epsg"), target_resolution_m=res_m,
            clerk_id=clerk_id,
        )
    elif job_type == "vector_transform":
        enqueue_vector_transform(
            job_id=job_id, vector_id=input_ref.get("vector_id"),
            target_epsg=input_ref.get("new_epsg"),
        )
    else:
        # Model-driven job: ML inference or raster analysis (e.g. gap_detection)
        params = job.get("input_params") or {}
        if isinstance(params, str):
            try: params = json.loads(params)
            except Exception: params = {}
        model_type = job.get("model_type") or "ml"
        if model_type == "raster":
            enqueue_raster_analysis(
                job_id=job_id, model_id=str(job["model_id"]),
                image_id=str(job["input_image_id"]), params=params, clerk_id=clerk_id,
            )
        else:
            enqueue_ml_job(
                job_id=job_id, model_id=str(job["model_id"]),
                image_id=str(job["input_image_id"]),
                vector_id=str(job["input_vector_id"]) if job.get("input_vector_id") else None,
                params=params,
            )
    return {"retried": True, "job_id": job_id}

# ── Images (admin) ────────────────────────────────────────────────────────────

@router.get("/images")
def list_all_images(limit: int = 200, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT i.id, i.filename, i.status, i.created_at, i.gcs_path,
               i.area_ha, i.epsg, i.filesize AS file_size_bytes,
               u.email, u.username
        FROM images i
        JOIN users u ON u.id = i.owner_id
        ORDER BY i.created_at DESC LIMIT %s
    """, (limit,))
    rows = cur.fetchall(); cur.close(); conn.close()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("created_at"): d["created_at"] = d["created_at"].isoformat()
        result.append(d)
    return {"images": result}

@router.delete("/images/{image_id}")
def admin_delete_image(image_id: str, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT gcs_path FROM images WHERE id=%s", (image_id,))
    row = cur.fetchone()
    if not row: raise HTTPException(404, "Image not found")
    gcs_path = row["gcs_path"]
    cur.execute("DELETE FROM job_outputs WHERE job_id IN (SELECT id FROM jobs WHERE input_image_id=%s)", (image_id,))
    cur.execute("DELETE FROM jobs WHERE input_image_id=%s", (image_id,))
    cur.execute("DELETE FROM images WHERE id=%s", (image_id,))
    conn.commit(); cur.close(); conn.close()
    try: storage.Client().bucket(GCS_BUCKET).blob(gcs_path).delete()
    except: pass
    return {"deleted": True, "image_id": image_id}

@router.post("/images/{image_id}/reprocess")
def admin_reprocess_image(image_id: str, _: str = Depends(require_superadmin)):
    """Re-enqueue raster ingest for a stuck/failed image."""
    from tasks import enqueue_raster_ingest
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT id, filename, gcs_path, owner_id FROM images WHERE id=%s", (image_id,))
    img = cur.fetchone()
    if not img: raise HTTPException(404, "Image not found")
    # Find or create the ingest job
    cur.execute("""
        SELECT id FROM jobs WHERE input_image_id=%s AND type='raster_ingest'
        ORDER BY created_at DESC LIMIT 1
    """, (image_id,))
    job_row = cur.fetchone()
    if job_row:
        cur.execute("UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, message=NULL WHERE id=%s", (job_row["id"],))
        job_id = str(job_row["id"])
    else:
        cur.execute("""
            INSERT INTO jobs (owner_id, type, status, params)
            VALUES (%s, 'raster_ingest', 'queued', %s) RETURNING id
        """, (img["owner_id"], json.dumps({"image_id": image_id, "gcs_path": img["gcs_path"], "filename": img["filename"]})))
        job_id = str(cur.fetchone()["id"])
    cur.execute("UPDATE images SET status='processing' WHERE id=%s", (image_id,))
    conn.commit(); cur.close(); conn.close()
    enqueue_raster_ingest(job_id=job_id, image_id=image_id, gcs_path=img["gcs_path"], filename=img["filename"])
    return {"reprocessing": True, "image_id": image_id, "job_id": job_id}


@router.post("/images/{image_id}/reset-status")
def admin_reset_image_status(image_id: str, _: str = Depends(require_superadmin)):
    """Reset a stuck/failed image back to ready."""
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("UPDATE images SET status='ready' WHERE id=%s", (image_id,))
    conn.commit(); cur.close(); conn.close()
    return {"reset": True, "image_id": image_id}

# ── Vectors (admin) ───────────────────────────────────────────────────────────

@router.get("/vectors")
def list_all_vectors(limit: int = 200, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT v.id, v.filename, v.status, v.created_at, v.gcs_path,
               v.epsg, v.filesize AS file_size_bytes,
               u.email, u.username
        FROM vectors v
        JOIN users u ON u.id = v.owner_id
        ORDER BY v.created_at DESC LIMIT %s
    """, (limit,))
    rows = cur.fetchall(); cur.close(); conn.close()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("created_at"): d["created_at"] = d["created_at"].isoformat()
        result.append(d)
    return {"vectors": result}

@router.delete("/vectors/{vector_id}")
def admin_delete_vector(vector_id: str, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT gcs_path FROM vectors WHERE id=%s", (vector_id,))
    row = cur.fetchone()
    if not row: raise HTTPException(404, "Vector not found")
    gcs_path = row["gcs_path"]
    cur.execute("DELETE FROM jobs WHERE input_vector_id=%s", (vector_id,))
    cur.execute("DELETE FROM vectors WHERE id=%s", (vector_id,))
    conn.commit(); cur.close(); conn.close()
    try: storage.Client().bucket(GCS_BUCKET).blob(gcs_path).delete()
    except: pass
    return {"deleted": True, "vector_id": vector_id}

@router.post("/vectors/{vector_id}/reprocess")
def admin_reprocess_vector(vector_id: str, _: str = Depends(require_superadmin)):
    """Re-enqueue vector ingest for a stuck/failed vector."""
    from tasks import enqueue_vector_ingest
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT id, filename, gcs_path, owner_id FROM vectors WHERE id=%s", (vector_id,))
    vec = cur.fetchone()
    if not vec: raise HTTPException(404, "Vector not found")
    cur.execute("""
        SELECT id FROM jobs WHERE input_vector_id=%s AND type='vector_ingest'
        ORDER BY created_at DESC LIMIT 1
    """, (vector_id,))
    job_row = cur.fetchone()
    if job_row:
        cur.execute("UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, message=NULL WHERE id=%s", (job_row["id"],))
        job_id = str(job_row["id"])
    else:
        cur.execute("""
            INSERT INTO jobs (owner_id, type, status, params)
            VALUES (%s, 'vector_ingest', 'queued', %s) RETURNING id
        """, (vec["owner_id"], json.dumps({"vector_id": vector_id, "gcs_path": vec["gcs_path"], "filename": vec["filename"]})))
        job_id = str(cur.fetchone()["id"])
    cur.execute("UPDATE vectors SET status='processing' WHERE id=%s", (vector_id,))
    conn.commit(); cur.close(); conn.close()
    enqueue_vector_ingest(job_id=job_id, vector_id=vector_id, gcs_path=vec["gcs_path"], filename=vec["filename"])
    return {"reprocessing": True, "vector_id": vector_id, "job_id": job_id}

# ── System ────────────────────────────────────────────────────────────────────

@router.get("/db/tables")
def list_db_tables(_: str = Depends(require_superadmin)):
    """Every table in the public schema, with row counts — lets the superadmin
    browse practically anything in Postgres without needing psql access."""
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    """)
    tables = [r["table_name"] for r in cur.fetchall()]
    result = []
    for t in tables:
        cur.execute(f'SELECT COUNT(*) AS n FROM "{t}"')
        result.append({"name": t, "row_count": cur.fetchone()["n"]})
    cur.close(); conn.close()
    return {"tables": result}

@router.get("/db/tables/{table_name}")
def get_db_table_rows(table_name: str, limit: int = 200, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    # Whitelist against the live schema — table_name is otherwise going
    # straight into an identifier position in raw SQL below.
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = %s
    """, (table_name,))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise HTTPException(404, "No such table")

    limit = max(1, min(limit, 1000))
    cur.execute(f'SELECT * FROM "{table_name}" ORDER BY 1 DESC LIMIT %s', (limit,))
    rows = cur.fetchall()
    columns = [d.name for d in cur.description]
    cur.close(); conn.close()

    def _jsonable(v):
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return v

    return {
        "table": table_name,
        "columns": columns,
        "rows": [{k: _jsonable(v) for k, v in dict(r).items()} for r in rows],
    }

@router.get("/system")
def get_system_info(_: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT
            (SELECT COUNT(*) FROM users)   AS users,
            (SELECT COUNT(*) FROM models)  AS models,
            (SELECT COUNT(*) FROM images)  AS images,
            (SELECT COUNT(*) FROM vectors) AS vectors,
            (SELECT COUNT(*) FROM jobs)    AS jobs,
            (SELECT COUNT(*) FROM jobs WHERE status='running') AS running_jobs,
            (SELECT COUNT(*) FROM jobs WHERE status='queued')  AS queued_jobs,
            (SELECT COALESCE(SUM(filesize),0) FROM images)     AS total_storage_bytes,
            (SELECT COALESCE(SUM(area_ha),0)  FROM images WHERE status='ready') AS total_ha_ingested
    """)
    row = dict(cur.fetchone()); cur.close(); conn.close()
    return row

@router.get("/system/health")
def system_health(_: str = Depends(require_superadmin)):
    results = []
    for name, url in MONITORED_SERVICES.items():
        headers = {} if name in PUBLIC_SERVICES else _id_token_headers(url)
        path = HEALTH_PATHS.get(name, "/health")
        started = time.monotonic()
        try:
            r = http_requests.get(f"{url}{path}", headers=headers, timeout=10, allow_redirects=False)
            ok = r.status_code < 500
            status_code = r.status_code
        except Exception:
            ok = False
            status_code = None
        results.append({
            "name": name,
            "url": url,
            "up": ok,
            "status_code": status_code,
            "latency_ms": round((time.monotonic() - started) * 1000),
        })
    return {"services": results}

# ── Public: models available for user ─────────────────────────────────────────

@models_router.get("/available")
def get_available_models(x_clerk_id: str = Header(..., alias="x-clerk-id")):
    user_id = database.get_user_id(x_clerk_id)
    if not user_id: return {"models": []}
    conn = database.get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT m.*
        FROM models m
        JOIN user_model_permissions ump ON ump.model_id = m.id
        WHERE ump.user_id = %s
          AND m.is_active = true
          AND COALESCE(ump.is_visible, true) = true
        ORDER BY m.name
    """, (user_id,))
    models = [dict(r) for r in cur.fetchall()]
    cur.close(); conn.close()
    for m in models:
        if m.get("created_at"): m["created_at"] = m["created_at"].isoformat()
        for f in ["inference_config","phase2_config","output_types"]:
            if isinstance(m.get(f), str):
                try: m[f] = json.loads(m[f])
                except: pass
    return {"models": models}
