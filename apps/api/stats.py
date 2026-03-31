import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)
router = APIRouter()


def get_current_user_id(authorization: str = Header(...)) -> str:
    import base64, json
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


def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def fetch_stats(clerk_id: str) -> dict:
    conn = get_conn()
    cur  = conn.cursor()

    cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return {"images": 0, "vectors": 0, "jobs": 0,
                "jobs_running": 0, "jobs_failed": 0, "models": 0}

    owner_id = row["id"]

    cur.execute("SELECT COUNT(*) AS n FROM images WHERE owner_id = %s", (owner_id,))
    image_count = cur.fetchone()["n"]

    cur.execute("SELECT COUNT(*) AS n FROM vectors WHERE owner_id = %s", (owner_id,))
    vector_count = cur.fetchone()["n"]

    cur.execute(
        """
        SELECT
            COUNT(*)                                            AS total,
            COUNT(*) FILTER (WHERE status = 'running')         AS running,
            COUNT(*) FILTER (WHERE status = 'failed')          AS failed
        FROM jobs WHERE owner_id = %s
        """,
        (owner_id,),
    )
    jobs_row = cur.fetchone()

    # Count models user has permission to run
    try:
        cur.execute(
            """
            SELECT COUNT(DISTINCT m.id) AS n
            FROM models m
            JOIN user_model_permissions p ON p.model_id = m.id
            WHERE p.user_id = %s AND m.is_active = true
            """,
            (owner_id,),
        )
        model_count = cur.fetchone()["n"]
    except Exception:
        model_count = 0

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


@router.get("")
def get_stats(clerk_id: str = Depends(get_current_user_id)):
    try:
        return fetch_stats(clerk_id)
    except Exception as e:
        log.error("stats failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{clerk_id}")
def get_stats_by_clerk_id(clerk_id: str):
    try:
        return fetch_stats(clerk_id)
    except Exception as e:
        log.error("stats failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))
