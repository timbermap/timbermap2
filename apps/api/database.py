import os
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
        cursor_factory=psycopg2.extras.RealDictCursor
    )

def ensure_user(clerk_id: str, email: str, username: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO users (clerk_id, email, username)
        VALUES (%s, %s, %s)
        ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email
        RETURNING id
    """, (clerk_id, email, username))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def get_user_id(clerk_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row['id'] if row else None

def insert_image(owner_id, filename, gcs_path, filesize):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO images (owner_id, filename, gcs_path, filesize, status)
        VALUES (%s, %s, %s, %s, 'uploaded')
        RETURNING id
    """, (owner_id, filename, gcs_path, filesize))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def insert_vector(owner_id, filename, gcs_path, filesize):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO vectors (owner_id, filename, gcs_path, filesize, status)
        VALUES (%s, %s, %s, %s, 'uploaded')
        RETURNING id
    """, (owner_id, filename, gcs_path, filesize))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def get_images(owner_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, filename, gcs_path, epsg, num_bands,
               area_ha, filesize, status, geoserver_layer, created_at,
               bbox_minx, bbox_miny, bbox_maxx, bbox_maxy
        FROM images WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def get_vectors(owner_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, filename, gcs_path, epsg, geometry_type,
               area_ha, filesize, status, geoserver_layer, created_at
        FROM vectors WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def get_jobs(owner_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, type, status, message, input_ref, output_ref,
               started_at, finished_at, created_at
        FROM jobs WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def insert_job(owner_id, job_type, input_ref):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO jobs (owner_id, type, status, input_ref)
        VALUES (%s, %s, 'queued', %s)
        RETURNING id
    """, (owner_id, job_type, psycopg2.extras.Json(input_ref)))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']
