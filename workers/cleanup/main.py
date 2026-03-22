"""
workers/cleanup/main.py
Cleanup worker — deletes rasters, vectors, and full user data.
"""

import os
import logging
from fastapi import FastAPI, HTTPException
from google.cloud import storage as gcs_lib
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="Timbermap Cleanup Worker")

GCS_BUCKET = os.getenv("GCS_BUCKET", "timbermap-data")


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def _build_engine():
    from sqlalchemy import create_engine
    host     = os.getenv("DB_HOST", "127.0.0.1")
    password = os.getenv("DB_PASSWORD")
    dbname   = os.getenv("DB_NAME", "timbermap")
    user     = os.getenv("DB_USER", "postgres")
    if host.startswith("/cloudsql"):
        url = f"postgresql+psycopg2://{user}:{password}@/{dbname}?host={host}"
    else:
        port = os.getenv("DB_PORT", "5432")
        url  = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"
    return create_engine(url)


# ── GCS helpers ───────────────────────────────────────────────────────────────

def _gcs_client():
    return gcs_lib.Client()


def delete_gcs_blobs(prefix: str):
    client = _gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    blobs  = list(bucket.list_blobs(prefix=prefix))
    if blobs:
        bucket.delete_blobs(blobs, on_error=lambda b: log.warning("GCS delete failed: %s", b))


def delete_gcs_blob(path: str):
    try:
        _gcs_client().bucket(GCS_BUCKET).blob(path).delete()
    except Exception:
        pass


# ── PostGIS helpers ───────────────────────────────────────────────────────────

def drop_postgis_table(schema: str, table: str):
    from sqlalchemy import text
    engine = _build_engine()
    with engine.connect() as conn:
        conn.execute(text(f'DROP TABLE IF EXISTS "{schema}"."{table}" CASCADE'))
        conn.commit()


def drop_postgis_schema(schema: str):
    from sqlalchemy import text
    engine = _build_engine()
    with engine.connect() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        conn.commit()


# ── Delete primitives ─────────────────────────────────────────────────────────

def _get_clerk_id_for_owner(owner_id, cur) -> str:
    cur.execute("SELECT clerk_id FROM users WHERE id = %s", (owner_id,))
    row = cur.fetchone()
    return row["clerk_id"] if row else str(owner_id)


def _delete_one_image(image_id: str, owner_id, cur):
    clerk_id = _get_clerk_id_for_owner(owner_id, cur)
    delete_gcs_blob(f"users/cogs/{image_id}.tif")
    delete_gcs_blob(f"users/thumbnails/{image_id}.jpg")
    delete_gcs_blobs(f"users/{clerk_id}/rasters/")
    cur.execute("DELETE FROM jobs WHERE input_ref->>'image_id' = %s", (str(image_id),))
    cur.execute("DELETE FROM images WHERE id = %s", (image_id,))


def _delete_one_vector(vector_id: str, owner_id, cur):
    clerk_id = _get_clerk_id_for_owner(owner_id, cur)
    table = f"vec_{vector_id.replace('-', '_')}"
    drop_postgis_table("vectors", table)
    delete_gcs_blobs(f"users/{clerk_id}/vectors/")
    cur.execute("DELETE FROM jobs WHERE input_ref->>'vector_id' = %s", (str(vector_id),))
    cur.execute("DELETE FROM vectors WHERE id = %s", (vector_id,))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "cleanup-worker"}


@app.delete("/raster/{image_id}")
def delete_raster(image_id: str):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT owner_id FROM images WHERE id = %s", (image_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Image {image_id} not found")
        _delete_one_image(image_id, row["owner_id"], cur)
        conn.commit()
        return {"deleted": "raster", "image_id": image_id}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()


@app.delete("/vector/{vector_id}")
def delete_vector(vector_id: str):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT owner_id FROM vectors WHERE id = %s", (vector_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Vector {vector_id} not found")
        _delete_one_vector(vector_id, row["owner_id"], cur)
        conn.commit()
        return {"deleted": "vector", "vector_id": vector_id}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()


@app.delete("/user/{clerk_id}")
def delete_user(clerk_id: str):
    conn = get_conn()
    cur  = conn.cursor()
    deleted = {"images": [], "vectors": []}
    try:
        cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
        user_row = cur.fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail=f"User {clerk_id} not found")
        owner_id = user_row["id"]

        cur.execute("SELECT id FROM images WHERE owner_id = %s", (owner_id,))
        for r in cur.fetchall():
            _delete_one_image(r["id"], owner_id, cur)
            deleted["images"].append(r["id"])

        cur.execute("SELECT id FROM vectors WHERE owner_id = %s", (owner_id,))
        for r in cur.fetchall():
            _delete_one_vector(r["id"], owner_id, cur)
            deleted["vectors"].append(r["id"])

        delete_gcs_blobs(f"users/{clerk_id}/")
        drop_postgis_schema(f"user_{clerk_id.replace('-', '_')}")

        cur.execute("DELETE FROM user_model_permissions WHERE clerk_id = %s", (clerk_id,))
        cur.execute("DELETE FROM jobs WHERE owner_id = %s", (owner_id,))
        cur.execute("DELETE FROM users WHERE clerk_id = %s", (clerk_id,))

        conn.commit()
        return {"deleted": "user", "clerk_id": clerk_id,
                "images_deleted": len(deleted["images"]),
                "vectors_deleted": len(deleted["vectors"])}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close(); conn.close()
