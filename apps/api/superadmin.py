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
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")


def _delete_clerk_user(clerk_id: str) -> bool:
    """Best-effort — deletes the user in Clerk itself, not just our DB.
    Non-fatal on failure (already-deleted, network hiccup, etc.) so it never
    blocks the data cleanup that already happened."""
    if not CLERK_SECRET_KEY:
        return False
    try:
        r = http_requests.delete(
            f"https://api.clerk.com/v1/users/{clerk_id}",
            headers={"Authorization": f"Bearer {CLERK_SECRET_KEY}"},
            timeout=30,
        )
        return r.status_code in (200, 204, 404)
    except Exception:
        return False

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
    required_vector_input: Optional[dict] = None
    required_gsd_cm: Optional[float] = None; image_type_note: Optional[str] = None

class ArtifactConfirmRequest(BaseModel):
    artifact_key: str; gcs_path: str; file_size: int = 0; checksum: str = ""

class GrantModelRequest(BaseModel):
    user_id: str; config_override: Optional[dict] = None; max_runs_month: Optional[int] = None

class SetSuperadminRequest(BaseModel):
    is_superadmin: bool

class SetPlanRequest(BaseModel):
    tier: str  # "basic" | "active" | "custom"

class SetPlanExpirationRequest(BaseModel):
    plan_expires_at: Optional[str] = None  # "YYYY-MM-DD", or null to clear it

class SetAccountLimitsRequest(BaseModel):
    storage_limit_gb: Optional[int] = None  # null clears the override, falls back to tier default
    weekly_job_limit: Optional[int] = None

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

@router.get("/am-i-admin")
def am_i_admin(x_clerk_id: str = Header(None, alias="x-clerk-id")):
    """Always 200 — for routine 'should I show the admin menu link?' checks
    on every page load. Unlike /health, never 403s a normal user, so it
    doesn't spam the console with an 'error' for the common case."""
    if not x_clerk_id:
        return {"is_superadmin": False}
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT is_superadmin FROM users WHERE clerk_id = %s", (x_clerk_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    return {"is_superadmin": bool(row and row["is_superadmin"])}

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

# ── Clerk instance migration helper ────────────────────────────────────────────
# One-off lookup used while reconciling users after the prod Clerk instance
# switch (dev and prod are separate user pools, so existing DB rows keyed on
# the old dev clerk_id no longer match anyone signing in for real).

@router.get("/clerk-user-by-email")
def clerk_user_by_email(email: str, _: str = Depends(require_superadmin)):
    if not CLERK_SECRET_KEY:
        raise HTTPException(500, "CLERK_SECRET_KEY not configured")
    r = http_requests.get(
        "https://api.clerk.com/v1/users",
        params={"email_address": [email]},
        headers={"Authorization": f"Bearer {CLERK_SECRET_KEY}"},
        timeout=15,
    )
    r.raise_for_status()
    users = r.json()
    if not users:
        raise HTTPException(404, "No Clerk user with that email")
    u = users[0]
    return {
        "clerk_id": u["id"],
        "email": email,
        "username": u.get("username"),
        "created_at": u.get("created_at"),
    }

@router.post("/reconcile-clerk-id")
def reconcile_clerk_id(old_clerk_id: str, new_clerk_id: str, _: str = Depends(require_superadmin)):
    """Repoints an existing users row at its new prod-instance clerk_id,
    preserving is_superadmin / account_id / everything else. If a fresh
    placeholder row already exists at new_clerk_id (created by the
    ensure_user fallback the first time this person hit the API under
    their new id), that placeholder — and its throwaway personal account,
    if nothing else references it — is discarded in favor of the real one."""
    conn = database.get_conn()
    cur  = conn.cursor()
    cur.execute("SELECT 1 FROM users WHERE clerk_id = %s", (old_clerk_id,))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise HTTPException(404, f"No user row with clerk_id={old_clerk_id}")

    cur.execute("SELECT account_id FROM users WHERE clerk_id = %s", (new_clerk_id,))
    placeholder = cur.fetchone()
    if placeholder:
        placeholder_account_id = placeholder["account_id"]
        cur.execute("DELETE FROM users WHERE clerk_id = %s", (new_clerk_id,))
        cur.execute("SELECT 1 FROM users WHERE account_id = %s", (placeholder_account_id,))
        if not cur.fetchone():
            cur.execute("DELETE FROM accounts WHERE id = %s", (placeholder_account_id,))

    cur.execute("UPDATE users SET clerk_id = %s WHERE clerk_id = %s", (new_clerk_id, old_clerk_id))
    conn.commit()
    cur.execute("SELECT clerk_id, email, is_superadmin FROM users WHERE clerk_id = %s", (new_clerk_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    return dict(row)

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
        if u.get("plan_expires_at"): u["plan_expires_at"] = u["plan_expires_at"].isoformat()
    return {"users": users}

@router.get("/users/{target_clerk_id}")
def get_user(target_clerk_id: str, _: str = Depends(require_superadmin)):
    user = database.superadmin_get_user_detail(target_clerk_id)
    if not user: raise HTTPException(404, "User not found")
    for f in ["created_at", "plan_expires_at"]:
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
    """Irreversibly deletes a user: all images, vectors, jobs, GCS files and
    PostGIS data (via the cleanup worker), the users row, the account row
    too if this was its last member, and the user in Clerk itself."""
    if target_clerk_id == admin_clerk_id:
        raise HTTPException(400, "Can't delete your own account from here")
    if not database.get_user_id(target_clerk_id):
        raise HTTPException(404, "User not found")

    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT account_id FROM users WHERE clerk_id = %s", (target_clerk_id,))
    row = cur.fetchone()
    account_id = row["account_id"] if row else None
    cur.close(); conn.close()

    try:
        r = http_requests.delete(
            f"{CLEANUP_WORKER_URL}/user/{target_clerk_id}",
            headers=cleanup_worker_headers(), timeout=120,
        )
        r.raise_for_status()
    except Exception as e:
        raise HTTPException(500, f"Cleanup worker failed: {e}")

    clerk_deleted = _delete_clerk_user(target_clerk_id)

    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE clerk_id = %s", (target_clerk_id,))
    account_deleted = False
    if account_id:
        cur.execute("SELECT 1 FROM users WHERE account_id = %s LIMIT 1", (account_id,))
        if not cur.fetchone():
            cur.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
            account_deleted = True
    conn.commit(); cur.close(); conn.close()

    return {
        "deleted": True, "clerk_id": target_clerk_id,
        "clerk_user_deleted": clerk_deleted,
        "account_row_deleted": account_deleted,
    }

@router.put("/users/{target_clerk_id}/plan")
def set_plan(target_clerk_id: str, req: SetPlanRequest, _: str = Depends(require_superadmin)):
    """Tier is fully manual now — superadmin picks basic/active/custom directly,
    independent of what models the account happens to have granted."""
    if req.tier not in ("basic", "active", "custom"):
        raise HTTPException(400, "tier must be 'basic', 'active' or 'custom'")
    ok = database.superadmin_set_plan(target_clerk_id, req.tier)
    if not ok: raise HTTPException(404, "User not found")
    return {"updated": True, "clerk_id": target_clerk_id, "plan": req.tier}

@router.put("/users/{target_clerk_id}/plan-expiration")
def set_plan_expiration(target_clerk_id: str, req: SetPlanExpirationRequest, _: str = Depends(require_superadmin)):
    ok = database.superadmin_set_plan_expiration(target_clerk_id, req.plan_expires_at)
    if not ok: raise HTTPException(404, "User not found")
    return {"updated": True, "clerk_id": target_clerk_id, "plan_expires_at": req.plan_expires_at}

@router.put("/users/{target_clerk_id}/limits")
def set_account_limits(target_clerk_id: str, req: SetAccountLimitsRequest, _: str = Depends(require_superadmin)):
    """Per-account overrides — leave a field null to fall back to the tier default."""
    ok = database.superadmin_set_account_limits(target_clerk_id, req.storage_limit_gb, req.weekly_job_limit)
    if not ok: raise HTTPException(404, "User not found")
    return {"updated": True, "clerk_id": target_clerk_id, "storage_limit_gb": req.storage_limit_gb, "weekly_job_limit": req.weekly_job_limit}

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
               i.bbox_minx, i.bbox_miny, i.bbox_maxx, i.bbox_maxy,
               u.email, u.username, u.clerk_id
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
    cur.execute("""
        SELECT i.id, i.filename, i.gcs_path, i.owner_id, u.clerk_id
        FROM images i JOIN users u ON u.id = i.owner_id
        WHERE i.id=%s
    """, (image_id,))
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
            INSERT INTO jobs (owner_id, type, status, input_ref, input_image_id)
            VALUES (%s, 'raster_ingest', 'queued', %s, %s) RETURNING id
        """, (img["owner_id"], json.dumps({"image_id": image_id, "gcs_path": img["gcs_path"], "filename": img["filename"]}), image_id))
        job_id = str(cur.fetchone()["id"])
    cur.execute("UPDATE images SET status='processing' WHERE id=%s", (image_id,))
    conn.commit(); cur.close(); conn.close()
    enqueue_raster_ingest(job_id=job_id, image_id=image_id, gcs_path=img["gcs_path"], filename=img["filename"], clerk_id=img["clerk_id"])
    return {"reprocessing": True, "image_id": image_id, "job_id": job_id}


class AdminTransformRequest(BaseModel):
    new_epsg: Optional[str] = None
    new_resolution_x: Optional[float] = None
    new_resolution_y: Optional[float] = None

@router.post("/images/{image_id}/transform")
def admin_transform_image(image_id: str, req: AdminTransformRequest, _: str = Depends(require_superadmin)):
    """Same logic as the self-service /images/transform, scoped by image_id
    directly instead of requiring the owner's clerk_id."""
    from tasks import enqueue_raster_transform
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT i.epsg, i.bbox_minx, i.bbox_miny, i.bbox_maxx, i.bbox_maxy, u.clerk_id
        FROM images i JOIN users u ON u.id = i.owner_id WHERE i.id = %s
    """, (image_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        raise HTTPException(404, "Image not found")
    res_m = req.new_resolution_x or req.new_resolution_y or None
    if not (req.new_epsg or res_m):
        cur.close(); conn.close()
        raise HTTPException(400, "Nothing to transform — provide new_epsg and/or a resolution")
    target_epsg = req.new_epsg
    if not target_epsg:
        current_epsg = row["epsg"]
        if res_m and current_epsg in ("4326", "4269", "4258", "4230"):
            minx, maxx, miny, maxy = row["bbox_minx"], row["bbox_maxx"], row["bbox_miny"], row["bbox_maxy"]
            if minx is not None and miny is not None:
                lon, lat = (minx + maxx) / 2, (miny + maxy) / 2
                zone = int((lon + 180) / 6) + 1
                target_epsg = str(32600 + zone if lat >= 0 else 32700 + zone)
            else:
                target_epsg = current_epsg
        else:
            target_epsg = current_epsg
    cur.execute("""
        INSERT INTO jobs (owner_id, type, status, input_ref, input_image_id)
        SELECT owner_id, 'raster_transform', 'queued', %s, %s FROM images WHERE id = %s
        RETURNING id
    """, (json.dumps({"image_id": image_id, "new_epsg": req.new_epsg, "new_resolution_x": req.new_resolution_x, "new_resolution_y": req.new_resolution_y}), image_id, image_id))
    job_id = str(cur.fetchone()["id"])
    conn.commit(); cur.close(); conn.close()
    enqueue_raster_transform(job_id, image_id, target_epsg, res_m, row["clerk_id"])
    return {"job_id": job_id, "status": "queued", "target_epsg": target_epsg}

@router.post("/vectors/{vector_id}/transform")
def admin_transform_vector(vector_id: str, req: AdminTransformRequest, _: str = Depends(require_superadmin)):
    from tasks import enqueue_vector_transform
    if not req.new_epsg:
        raise HTTPException(400, "new_epsg is required")
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("SELECT owner_id FROM vectors WHERE id = %s", (vector_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        raise HTTPException(404, "Vector not found")
    cur.execute("""
        INSERT INTO jobs (owner_id, type, status, input_ref, input_vector_id)
        VALUES (%s, 'vector_transform', 'queued', %s, %s) RETURNING id
    """, (row["owner_id"], json.dumps({"vector_id": vector_id, "new_epsg": req.new_epsg}), vector_id))
    job_id = str(cur.fetchone()["id"])
    conn.commit(); cur.close(); conn.close()
    enqueue_vector_transform(job_id, vector_id, req.new_epsg)
    return {"job_id": job_id, "status": "queued"}


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
               u.email, u.username, u.clerk_id
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
            INSERT INTO jobs (owner_id, type, status, input_ref, input_vector_id)
            VALUES (%s, 'vector_ingest', 'queued', %s, %s) RETURNING id
        """, (vec["owner_id"], json.dumps({"vector_id": vector_id, "gcs_path": vec["gcs_path"], "filename": vec["filename"]}), vector_id))
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
        result.append({"name": t, "row_count": cur.fetchone()["n"], "readonly": t in DB_BROWSER_READONLY})
    cur.close(); conn.close()
    return {"tables": result}

# Tables whose rows resolve to a human via one of these FK columns — the
# browser adds the resolved email as an extra column so raw UUIDs aren't
# the only way to tell whose data a row belongs to.
OWNER_FK_COLUMN = {
    "images": "owner_id", "vectors": "owner_id", "jobs": "owner_id",
    "upgrade_requests": "user_id", "user_model_permissions": "user_id",
}
# Tables with their own dedicated, cascade-aware admin flow elsewhere —
# generic edit/delete here would bypass GCS/PostGIS/Clerk cleanup, so the
# browser stays read-only for these on purpose.
DB_BROWSER_READONLY = {"users", "accounts", "tier_limits", "user_model_permissions", "spatial_ref_sys", "images", "vectors"}

def _validate_table(cur, table_name: str):
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = %s
    """, (table_name,))
    if not cur.fetchone():
        raise HTTPException(404, "No such table")

@router.get("/db/tables/{table_name}")
def get_db_table_rows(table_name: str, limit: int = 200, _: str = Depends(require_superadmin)):
    conn = database.get_conn(); cur = conn.cursor()
    # Whitelist against the live schema — table_name is otherwise going
    # straight into an identifier position in raw SQL below.
    _validate_table(cur, table_name)

    limit = max(1, min(limit, 1000))
    fk_col = OWNER_FK_COLUMN.get(table_name)
    if fk_col:
        cur.execute(
            f'SELECT t.*, u.email AS "_owner_email" FROM "{table_name}" t '
            f'LEFT JOIN users u ON u.id = t."{fk_col}" ORDER BY 1 DESC LIMIT %s',
            (limit,),
        )
    else:
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
        "editable": table_name not in DB_BROWSER_READONLY,
    }

@router.put("/db/tables/{table_name}/{row_id}")
def update_db_table_row(table_name: str, row_id: str, body: dict, _: str = Depends(require_superadmin)):
    if table_name in DB_BROWSER_READONLY:
        raise HTTPException(403, "This table is managed from its dedicated tab, not editable here")
    conn = database.get_conn(); cur = conn.cursor()
    _validate_table(cur, table_name)
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
    """, (table_name,))
    valid_cols = {r["column_name"] for r in cur.fetchall()}
    updates = {k: v for k, v in body.items() if k in valid_cols and k != "id"}
    if not updates:
        cur.close(); conn.close()
        raise HTTPException(400, "No editable columns in body")
    set_clause = ", ".join(f'"{k}" = %s' for k in updates)
    cur.execute(
        f'UPDATE "{table_name}" SET {set_clause} WHERE id = %s RETURNING id',
        (*updates.values(), row_id),
    )
    row = cur.fetchone()
    conn.commit(); cur.close(); conn.close()
    if not row: raise HTTPException(404, "Row not found")
    return {"updated": True, "table": table_name, "id": row_id}

@router.delete("/db/tables/{table_name}/{row_id}")
def delete_db_table_row(table_name: str, row_id: str, _: str = Depends(require_superadmin)):
    if table_name in DB_BROWSER_READONLY:
        raise HTTPException(403, "This table is managed from its dedicated tab, not deletable here")
    conn = database.get_conn(); cur = conn.cursor()
    _validate_table(cur, table_name)

    # Best-effort: cascade job_outputs when deleting a job, and clean up the
    # row's own GCS blob if it has a gcs_path column — a raw DELETE alone
    # would otherwise orphan the file in storage.
    if table_name == "jobs":
        cur.execute('SELECT gcs_path FROM job_outputs WHERE job_id = %s', (row_id,))
        for r in cur.fetchall():
            if r["gcs_path"]:
                try: storage.Client().bucket(GCS_BUCKET).blob(r["gcs_path"]).delete()
                except Exception: pass
        cur.execute('DELETE FROM job_outputs WHERE job_id = %s', (row_id,))

    cur.execute("""
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = 'gcs_path'
    """, (table_name,))
    if cur.fetchone():
        cur.execute(f'SELECT gcs_path FROM "{table_name}" WHERE id = %s', (row_id,))
        row = cur.fetchone()
        if row and row["gcs_path"]:
            try: storage.Client().bucket(GCS_BUCKET).blob(row["gcs_path"]).delete()
            except Exception: pass

    cur.execute(f'DELETE FROM "{table_name}" WHERE id = %s RETURNING id', (row_id,))
    row = cur.fetchone()
    conn.commit(); cur.close(); conn.close()
    if not row: raise HTTPException(404, "Row not found")
    return {"deleted": True, "table": table_name, "id": row_id}

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
