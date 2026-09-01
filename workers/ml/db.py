import os
import json
import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv()

# One pool per process — connections are borrowed and returned, never left open.
# maxconn=3 is generous for a single-job worker; even 1 would suffice since
# all DB calls within a job happen sequentially on the same thread.
_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=3,
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT", 5432)),
            dbname=os.getenv("DB_NAME", "timbermap"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD"),
        )
    return _pool


@contextmanager
def _conn():
    """Borrow a connection from the pool; return it when done."""
    pool = _get_pool()
    conn = pool.getconn()
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    try:
        yield conn
    finally:
        pool.putconn(conn)


def get_model(model_id: str) -> dict:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM models WHERE id = %s AND is_active = true", (model_id,))
        row = cur.fetchone()
        cur.close()
    if not row:
        raise ValueError(f"Model {model_id} not found or inactive")
    return dict(row)


def get_model_artifacts(model_id: str) -> list[dict]:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM model_artifacts WHERE model_id = %s ORDER BY artifact_key",
            (model_id,)
        )
        rows = cur.fetchall()
        cur.close()
    return [dict(r) for r in rows]


def get_image(image_id: str) -> dict:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT i.id, i.filename, i.gcs_path, i.epsg, i.num_bands,
                   i.pixel_size_x, i.pixel_size_y,
                   i.bbox_minx, i.bbox_miny, i.bbox_maxx, i.bbox_maxy,
                   u.clerk_id
            FROM images i
            JOIN users u ON u.id = i.owner_id
            WHERE i.id = %s
        """, (image_id,))
        row = cur.fetchone()
        cur.close()
    if not row:
        raise ValueError(f"Image {image_id} not found")
    return dict(row)


def get_vector(vector_id: str) -> dict:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, filename, gcs_path, epsg FROM vectors WHERE id = %s", (vector_id,))
        row = cur.fetchone()
        cur.close()
    if not row:
        raise ValueError(f"Vector {vector_id} not found")
    return dict(row)


def get_vector_geojson(vector_id: str) -> dict:
    """Returns a GeoJSON FeatureCollection from the DB table for a vector."""
    table = f"vec_{vector_id.replace('-', '_')}"
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT json_build_object(
                'type', 'FeatureCollection',
                'features', json_agg(
                    json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(geometry)::json,
                        'properties', (to_jsonb(t) - 'geometry')::json
                    )
                )
            ) AS fc
            FROM "vectors"."{table}" t
        """)
        row = cur.fetchone()
        cur.close()
    if not row or not row["fc"]:
        raise ValueError(f"No geometry found in DB table for vector {vector_id}")
    return row["fc"]


def is_cancelled(job_id: str) -> bool:
    try:
        with _conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT status FROM jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
            cur.close()
        return bool(row and row["status"] == "cancelled")
    except Exception:
        return False


def update_job_status(job_id: str, status: str, message: str = None):
    with _conn() as conn:
        cur = conn.cursor()
        if status == "running":
            cur.execute("""
                UPDATE jobs SET status = %s, message = %s, started_at = now()
                WHERE id = %s AND started_at IS NULL
            """, (status, message or "Running...", job_id))
            if cur.rowcount == 0:
                # already started — just update message
                cur.execute(
                    "UPDATE jobs SET message = %s WHERE id = %s",
                    (message or "Running...", job_id)
                )
        elif status in ("done", "failed"):
            cur.execute("""
                UPDATE jobs SET status = %s, message = %s, finished_at = now()
                WHERE id = %s
            """, (status, message or status, job_id))
        else:
            cur.execute("UPDATE jobs SET status = %s, message = %s WHERE id = %s",
                        (status, message, job_id))
        conn.commit()
        cur.close()


def update_job_summary(job_id: str, summary: dict):
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE jobs SET summary = %s, status = 'done', finished_at = now()
            WHERE id = %s
        """, (json.dumps(summary), job_id))
        conn.commit()
        cur.close()


def insert_job_output(job_id: str, output_type: str, label: str, gcs_path: str,
                      file_size: int, is_visualizable: bool, layer_type: str = None,
                      epsg: int = None, bbox: list = None):
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO job_outputs
                (job_id, output_type, label, gcs_path, file_size_bytes,
                 is_visualizable, layer_type, epsg, bbox)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            job_id, output_type, label, gcs_path, file_size,
            is_visualizable, layer_type, epsg,
            json.dumps(bbox) if bbox else None,
        ))
        row = cur.fetchone()
        conn.commit()
        cur.close()
    return row['id']
