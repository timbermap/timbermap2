import os
import json
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()


def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def get_model(model_id: str) -> dict:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM models WHERE id = %s AND is_active = true", (model_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    if not row:
        raise ValueError(f"Model {model_id} not found or inactive")
    return dict(row)


def get_model_artifacts(model_id: str) -> list[dict]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM model_artifacts WHERE model_id = %s ORDER BY artifact_key",
        (model_id,)
    )
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [dict(r) for r in rows]


def get_image(image_id: str) -> dict:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, filename, gcs_path, epsg, num_bands,
               pixel_size_x, pixel_size_y, bbox_minx, bbox_miny, bbox_maxx, bbox_maxy
        FROM images WHERE id = %s
    """, (image_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    if not row:
        raise ValueError(f"Image {image_id} not found")
    return dict(row)


def get_vector(vector_id: str) -> dict:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, filename, gcs_path, epsg FROM vectors WHERE id = %s", (vector_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    if not row:
        raise ValueError(f"Vector {vector_id} not found")
    return dict(row)


def update_job_status(job_id: str, status: str, message: str = None):
    conn = get_conn()
    cur = conn.cursor()
    if status == "running":
        cur.execute("""
            UPDATE jobs SET status = %s, message = %s, started_at = now()
            WHERE id = %s
        """, (status, message or "Running...", job_id))
    elif status in ("done", "failed"):
        cur.execute("""
            UPDATE jobs SET status = %s, message = %s, finished_at = now()
            WHERE id = %s
        """, (status, message or status, job_id))
    else:
        cur.execute("UPDATE jobs SET status = %s, message = %s WHERE id = %s",
                    (status, message, job_id))
    conn.commit()
    cur.close(); conn.close()


def update_job_summary(job_id: str, summary: dict):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE jobs SET summary = %s, status = 'done', finished_at = now()
        WHERE id = %s
    """, (json.dumps(summary), job_id))
    conn.commit()
    cur.close(); conn.close()


def insert_job_output(job_id: str, output_type: str, label: str, gcs_path: str,
                      file_size: int, is_visualizable: bool, layer_type: str = None,
                      epsg: int = None, bbox: list = None):
    conn = get_conn()
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
    cur.close(); conn.close()
    return row['id']
