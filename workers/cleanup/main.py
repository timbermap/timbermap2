"""
workers/cleanup/main.py
Cleanup worker — deletes rasters, vectors, and full user data.

Deploy:
    gcloud run deploy timbermap-cleanup-worker \\
        --source . --region us-central1 --platform managed \\
        --no-allow-unauthenticated --port 8080 --cpu 1 --memory 512Mi \\
        --min-instances 0 --max-instances 3 --timeout 300 \\
        --add-cloudsql-instances timbermap-prod:us-central1:timbermap-db \\
        --set-env-vars "GCP_PROJECT=timbermap-prod,GCS_BUCKET=timbermap-data,..." \\
        --update-secrets="DB_PASSWORD=pg-password:latest,GEOSERVER_PASSWORD=geoserver-password:latest"

Called by: FastAPI main API (timbermap-api) via internal Cloud Run HTTP requests.
Endpoints are NOT public (--no-allow-unauthenticated).
"""

import os
import logging
from fastapi import FastAPI, HTTPException

from google.cloud import storage as gcs_lib
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from geoserver import delete_raster_layer, delete_vector_layer

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
    """Delete all GCS objects under a given prefix."""
    client = _gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    blobs  = list(bucket.list_blobs(prefix=prefix))
    if blobs:
        bucket.delete_blobs(blobs, on_error=lambda b: log.warning("GCS delete failed: %s", b))
    log.info("Deleted %d GCS objects under gs://%s/%s", len(blobs), GCS_BUCKET, prefix)


def delete_gcs_blob(path: str):
    """Delete a single GCS object. Non-fatal if missing."""
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
    log.info("Dropped PostGIS table: %s.%s", schema, table)


def drop_postgis_schema(schema: str):
    from sqlalchemy import text
    engine = _build_engine()
    with engine.connect() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        conn.commit()
    log.info("Dropped PostGIS schema: %s", schema)


# ── Low-level delete primitives ───────────────────────────────────────────────

def _delete_one_image(image_id: str, clerk_id: str, cur):
    """
    Delete a single raster image:
      1. GeoServer layer + store
      2. GCS COG + thumbnail + original upload
      3. jobs rows
      4. images row
    """
    log.info("Deleting image %s", image_id)

    # GeoServer (best-effort)
    try:
        delete_raster_layer(image_id)
    except Exception as e:
        log.warning("GeoServer raster delete failed for %s: %s", image_id, e)

    # GCS
    delete_gcs_blob(f"users/cogs/{image_id}.tif")
    delete_gcs_blob(f"users/thumbnails/{image_id}.jpg")
    # Original upload (rasters stored under users/{clerk_id}/rasters/)
    delete_gcs_blobs(f"users/{clerk_id}/rasters/{image_id}")

    # DB
    cur.execute("DELETE FROM jobs WHERE image_id = %s", (image_id,))
    cur.execute("DELETE FROM images WHERE id = %s", (image_id,))


def _delete_one_vector(vector_id: str, clerk_id: str, cur):
    """
    Delete a single vector:
      1. GeoServer FeatureType
      2. PostGIS table
      3. GCS upload
      4. jobs rows
      5. vectors row
    """
    log.info("Deleting vector %s", vector_id)

    # GeoServer (best-effort)
    try:
        delete_vector_layer(vector_id)
    except Exception as e:
        log.warning("GeoServer vector delete failed for %s: %s", vector_id, e)

    # PostGIS
    table = f"vec_{vector_id.replace('-', '_')}"
    drop_postgis_table("vectors", table)

    # GCS original upload
    delete_gcs_blobs(f"users/{clerk_id}/vectors/{vector_id}")

    # DB
    cur.execute("DELETE FROM jobs WHERE vector_id = %s", (vector_id,))
    cur.execute("DELETE FROM vectors WHERE id = %s", (vector_id,))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "cleanup-worker"}


@app.delete("/raster/{image_id}")
def delete_raster(image_id: str):
    """
    DELETE a single raster:
    GeoServer layer + GCS files + DB record + related jobs.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT clerk_id FROM images WHERE id = %s", (image_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Image {image_id} not found")

        _delete_one_image(image_id, row["clerk_id"], cur)
        conn.commit()
        return {"deleted": "raster", "image_id": image_id}

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        log.error("delete_raster failed for %s: %s", image_id, e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.delete("/vector/{vector_id}")
def delete_vector(vector_id: str):
    """
    DELETE a single vector:
    GeoServer layer + PostGIS table + GCS files + DB record + related jobs.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT clerk_id FROM vectors WHERE id = %s", (vector_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Vector {vector_id} not found")

        _delete_one_vector(vector_id, row["clerk_id"], cur)
        conn.commit()
        return {"deleted": "vector", "vector_id": vector_id}

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        log.error("delete_vector failed for %s: %s", vector_id, e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.delete("/user/{clerk_id}")
def delete_user(clerk_id: str):
    """
    Full user cascade:
      • All images   → GeoServer + GCS + DB
      • All vectors  → GeoServer + PostGIS + GCS + DB
      • PostGIS user schema (user_{clerk_id}) if it exists
      • All GCS objects under users/{clerk_id}/
      • jobs, user_model_permissions, users rows

    This is irreversible. Caller (API) must verify auth before invoking.
    """
    conn = get_conn()
    cur  = conn.cursor()
    deleted = {"images": [], "vectors": []}

    try:
        # Verify user exists
        cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"User {clerk_id} not found")

        # --- Images ---
        cur.execute("SELECT id FROM images WHERE clerk_id = %s", (clerk_id,))
        image_ids = [r["id"] for r in cur.fetchall()]
        for iid in image_ids:
            _delete_one_image(iid, clerk_id, cur)
            deleted["images"].append(iid)

        # --- Vectors ---
        cur.execute("SELECT id FROM vectors WHERE clerk_id = %s", (clerk_id,))
        vector_ids = [r["id"] for r in cur.fetchall()]
        for vid in vector_ids:
            _delete_one_vector(vid, clerk_id, cur)
            deleted["vectors"].append(vid)

        # --- Remaining GCS objects (any orphaned files) ---
        delete_gcs_blobs(f"users/{clerk_id}/")

        # --- Drop per-user PostGIS schema if present ---
        # Convention: user schemas are named  user_<clerk_id_underscored>
        schema = f"user_{clerk_id.replace('-', '_')}"
        drop_postgis_schema(schema)

        # --- DB: remaining user data ---
        cur.execute("DELETE FROM user_model_permissions WHERE clerk_id = %s", (clerk_id,))
        cur.execute("DELETE FROM jobs WHERE clerk_id = %s", (clerk_id,))
        cur.execute("DELETE FROM users WHERE clerk_id = %s", (clerk_id,))

        conn.commit()
        log.info(
            "User %s deleted: %d images, %d vectors",
            clerk_id, len(deleted["images"]), len(deleted["vectors"]),
        )
        return {
            "deleted": "user",
            "clerk_id": clerk_id,
            "images_deleted": len(deleted["images"]),
            "vectors_deleted": len(deleted["vectors"]),
        }

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        log.error("delete_user failed for %s: %s", clerk_id, e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.delete("/project/{project_id}")
def delete_project(project_id: str):
    """
    Project cascade — deletes all images, vectors, and jobs associated with
    a project_id.

    NOTE: This endpoint is ready for when a projects table is added.
    Currently, 'project_id' is treated as a filtering field on the images
    and vectors tables.  Add a 'project_id' column to both tables and this
    will work as-is.  Until then it returns 501.
    """
    # TODO: uncomment once project_id columns exist on images + vectors tables.
    #
    # conn = get_conn()
    # cur  = conn.cursor()
    # try:
    #     cur.execute("SELECT id, clerk_id FROM images WHERE project_id = %s", (project_id,))
    #     for row in cur.fetchall():
    #         _delete_one_image(row["id"], row["clerk_id"], cur)
    #
    #     cur.execute("SELECT id, clerk_id FROM vectors WHERE project_id = %s", (project_id,))
    #     for row in cur.fetchall():
    #         _delete_one_vector(row["id"], row["clerk_id"], cur)
    #
    #     cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))
    #     conn.commit()
    #     return {"deleted": "project", "project_id": project_id}
    # finally:
    #     cur.close(); conn.close()

    raise HTTPException(
        status_code=501,
        detail=(
            "Project cascade requires a project_id column on images + vectors tables. "
            "Add that column and uncomment the implementation in cleanup/main.py."
        ),
    )
