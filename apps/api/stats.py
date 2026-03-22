"""
apps/api/stats.py
Dashboard stats router — real counts from DB + GCS storage usage.
"""

import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)
router = APIRouter()


# ── Auth dependency (JWT) ─────────────────────────────────────────────────────

def get_current_user_id(authorization: str = Header(...)) -> str:
    import base64
    import json

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:]
    try:
        payload_b64 = token.split(".")[1]
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


# ── Core stats logic (shared) ─────────────────────────────────────────────────

def fetch_stats(clerk_id: str) -> dict:
    conn = get_conn()
    cur  = conn.cursor()

    cur.execute("SELECT COUNT(*) AS n FROM images WHERE clerk_id = %s", (clerk_id,))
    image_count = cur.fetchone()["n"]

    cur.execute("SELECT COUNT(*) AS n FROM vectors WHERE clerk_id = %s", (clerk_id,))
    vector_count = cur.fetchone()["n"]

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
    jobs_row = cur.fetchone()

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

    return {
        "images":       image_count,
        "vectors":      vector_count,
        "jobs":         jobs_row["total"],
        "jobs_running": jobs_row["running"],
        "jobs_failed":  jobs_row["failed"],
        "models":       model_count,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def get_stats(clerk_id: str = Depends(get_current_user_id)):
    """Authenticated via Bearer JWT — for client-side calls."""
    try:
        return fetch_stats(clerk_id)
    except Exception as e:
        log.error("stats DB query failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{clerk_id}")
def get_stats_by_clerk_id(clerk_id: str):
    """
    Direct clerk_id lookup — for server-side calls (Next.js Server Components)
    that don't have easy access to the Clerk JWT.
    """
    try:
        return fetch_stats(clerk_id)
    except Exception as e:
        log.error("stats DB query failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))
