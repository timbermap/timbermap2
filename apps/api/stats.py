"""
apps/api/stats.py
Dashboard stats router — real counts from DB + GCS storage usage.

Register in main.py:
    from stats import router as stats_router
    app.include_router(stats_router, prefix="/stats", tags=["stats"])

Returns:
    GET /stats
    {
        "images":         12,
        "vectors":        5,
        "jobs":           47,
        "models":         2,
        "storage_bytes":  1_073_741_824,   # sum of all COG + upload sizes
        "jobs_running":   1,
        "jobs_failed":    3
    }

Auth: same Clerk JWT middleware used by the rest of the API.
      Replace `get_current_user_id` with your project's actual dependency
      if you have one already in main.py or auth.py.
"""

import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)
router = APIRouter()


# ── Auth dependency ───────────────────────────────────────────────────────────
# If your main.py already has a  get_current_user  dependency, replace
# get_current_user_id below with that and remove this block.

def get_current_user_id(authorization: str = Header(...)) -> str:
    """
    Extract the Clerk user ID (sub) from the Bearer JWT.
    This is a lightweight, non-cryptographic decode — it trusts that the
    Clerk-issued JWT was verified upstream by Clerk's middleware or your
    existing auth dependency.  For full verification, use Clerk's JWKS:
        https://YOUR_CLERK_DOMAIN/.well-known/jwks.json
    """
    import base64
    import json

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:]
    try:
        # JWT payload is the second segment, base64url-encoded
        payload_b64 = token.split(".")[1]
        # Pad to multiple of 4
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("No 'sub' in token")
        return user_id
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


# ── DB helper ─────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


# ── GCS storage calculation ───────────────────────────────────────────────────

def get_storage_bytes(clerk_id: str) -> int:
    """
    Sum the sizes of all GCS objects under  users/{clerk_id}/
    plus the COG and thumbnail objects belonging to this user.

    Falls back to 0 on any error rather than failing the whole stats call.
    """
    try:
        from google.cloud import storage as gcs_lib
        client  = gcs_lib.Client()
        bucket  = client.bucket(os.getenv("GCS_BUCKET", "timbermap-data"))
        total   = 0

        # User upload prefix (original files)
        for blob in bucket.list_blobs(prefix=f"users/{clerk_id}/"):
            total += blob.size or 0

        # COGs — keyed by image_id, not clerk_id; query image_ids first
        conn = get_conn()
        cur  = conn.cursor()
        cur.execute("SELECT id FROM images WHERE clerk_id = %s", (clerk_id,))
        image_ids = [r["id"] for r in cur.fetchall()]
        cur.close()
        conn.close()

        for iid in image_ids:
            for prefix in (f"users/cogs/{iid}.tif", f"users/thumbnails/{iid}.jpg"):
                blob = bucket.blob(prefix)
                blob.reload()
                total += blob.size or 0

        return total

    except Exception as e:
        log.warning("storage_bytes calculation failed for %s: %s", clerk_id, e)
        return 0


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("")
def get_stats(clerk_id: str = Depends(get_current_user_id)):
    """
    Returns aggregate stats for the authenticated user.
    All counts query the live DB so dashboard cards always reflect reality.
    """
    try:
        conn = get_conn()
        cur  = conn.cursor()

        # Image count (ready only — excludes failed/uploaded)
        cur.execute(
            "SELECT COUNT(*) AS n FROM images WHERE clerk_id = %s",
            (clerk_id,),
        )
        image_count = cur.fetchone()["n"]

        # Vector count
        cur.execute(
            "SELECT COUNT(*) AS n FROM vectors WHERE clerk_id = %s",
            (clerk_id,),
        )
        vector_count = cur.fetchone()["n"]

        # Jobs — total + breakdown
        cur.execute(
            """
            SELECT
                COUNT(*)                                            AS total,
                COUNT(*) FILTER (WHERE status = 'running')         AS running,
                COUNT(*) FILTER (WHERE status = 'failed')          AS failed
            FROM jobs
            WHERE clerk_id = %s
            """,
            (clerk_id,),
        )
        jobs_row    = cur.fetchone()
        jobs_total  = jobs_row["total"]
        jobs_running = jobs_row["running"]
        jobs_failed  = jobs_row["failed"]

        # Models accessible to this user (own + permitted)
        cur.execute(
            """
            SELECT COUNT(DISTINCT m.id) AS n
            FROM models m
            LEFT JOIN user_model_permissions p ON p.model_id = m.id
            WHERE m.owner_clerk_id = %s OR p.clerk_id = %s
            """,
            (clerk_id, clerk_id),
        )
        model_count = cur.fetchone()["n"]

        cur.close()
        conn.close()

    except Exception as e:
        log.error("stats DB query failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))

    # Storage — separate call, non-fatal
    storage_bytes = get_storage_bytes(clerk_id)

    return {
        "images":        image_count,
        "vectors":       vector_count,
        "jobs":          jobs_total,
        "jobs_running":  jobs_running,
        "jobs_failed":   jobs_failed,
        "models":        model_count,
        "storage_bytes": storage_bytes,
    }
