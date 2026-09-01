import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)
router = APIRouter()


def get_current_user_id(x_clerk_id: str = Header(..., alias="x-clerk-id")) -> str:
    return x_clerk_id


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
def get_stats_by_clerk_id(clerk_id: str, requester_id: str = Depends(get_current_user_id)):
    if clerk_id != requester_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        return fetch_stats(clerk_id)
    except Exception as e:
        log.error("stats failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{clerk_id}/detailed")
def get_detailed_stats(clerk_id: str, requester_id: str = Depends(get_current_user_id)):
    """
    Returns full stats for the user's dashboard:
    - images: list with area_ha, filesize, created_at, status
    - vectors: list with area_ha, filesize, geometry_type, created_at, status
    - jobs: list with type, status, pipeline_type, image_ha, vector_ha, aoi_used, created_at, finished_at
    """
    if clerk_id != requester_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    conn = get_conn()
    cur  = conn.cursor()

    cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return {"images": [], "vectors": [], "jobs": []}
    owner_id = row["id"]

    # Images
    cur.execute("""
        SELECT id, filename, status, area_ha, filesize, epsg, num_bands,
               pixel_size_x, pixel_size_y, created_at
        FROM images
        WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    images = [dict(r) for r in cur.fetchall()]
    for img in images:
        if img.get("created_at"):
            img["created_at"] = img["created_at"].isoformat()

    # Vectors
    cur.execute("""
        SELECT id, filename, status, area_ha, filesize, geometry_type, epsg, created_at
        FROM vectors
        WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    vectors = [dict(r) for r in cur.fetchall()]
    for v in vectors:
        if v.get("created_at"):
            v["created_at"] = v["created_at"].isoformat()

    # Jobs — joined with image/vector area and model pipeline_type
    cur.execute("""
        SELECT
            j.id, j.type, j.status, j.message,
            j.input_image_id, j.input_vector_id,
            j.input_ref, j.input_params, j.summary,
            j.created_at, j.started_at, j.finished_at,
            i.area_ha   AS image_ha,
            i.filename  AS image_filename,
            v.area_ha   AS vector_ha,
            v.filename  AS vector_filename,
            m.name          AS model_name,
            m.pipeline_type AS pipeline_type
        FROM jobs j
        LEFT JOIN images  i ON i.id = j.input_image_id
        LEFT JOIN vectors v ON v.id = j.input_vector_id
        LEFT JOIN models  m ON m.id = j.model_id
        WHERE j.owner_id = %s
        ORDER BY j.created_at DESC
    """, (owner_id,))
    jobs = []
    for r in cur.fetchall():
        d = dict(r)
        for k in ["created_at", "started_at", "finished_at"]:
            if d.get(k):
                d[k] = d[k].isoformat()
        # Determine AOI usage and ha processed
        aoi_used = d["input_vector_id"] is not None or (
            d.get("input_params") and d["input_params"].get("aoi_geojson")
        )
        # ha processed: prefer vector area if AOI used, else image area
        if aoi_used and d.get("vector_ha"):
            ha_processed = d["vector_ha"]
        else:
            ha_processed = d.get("image_ha")
        d["aoi_used"]     = aoi_used
        d["ha_processed"] = ha_processed
        # Clean jsonb fields that aren't needed on frontend
        d.pop("input_params", None)
        jobs.append(d)

    cur.close()
    conn.close()
    return {"images": images, "vectors": vectors, "jobs": jobs}
