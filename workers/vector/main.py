"""
workers/vector/main.py
Vector ingest + PostGIS worker.

New vs original:
  • /ingest   — publishes layer to GeoServer after PostGIS load,
                writes geoserver_layer to vectors table.
  • /transform — reprojects via gdf.to_crs(), replaces PostGIS table,
                 re-registers GeoServer layer, updates DB.

Env vars added:
    GEOSERVER_URL       GeoServer Cloud Run URL
    GEOSERVER_PASSWORD  from Secret Manager geoserver-password
"""

import os
import json
import tempfile
import zipfile
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from google.cloud import storage, pubsub_v1
import geopandas as gpd
from shapely.validation import make_valid
from shapely.geometry import MultiPolygon
from db import get_conn

from geoserver import publish_vector_layer

load_dotenv()

app = FastAPI(title="Timbermap Vector Worker")


# ── DB helpers ────────────────────────────────────────────────────────────────

def update_job(job_id: str, status: str, message: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE jobs
        SET status     = %s,
            message    = %s,
            started_at  = CASE WHEN status = 'queued' THEN NOW() ELSE started_at END,
            finished_at = CASE WHEN %s IN ('done','failed') THEN NOW() ELSE NULL END
        WHERE id = %s
        """,
        (status, message, status, job_id),
    )
    conn.commit()
    cur.close()
    conn.close()


def update_vector(vector_id: str, **kwargs):
    if not kwargs:
        return
    fields = ", ".join(f"{k} = %s" for k in kwargs)
    values = list(kwargs.values()) + [vector_id]
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"UPDATE vectors SET {fields} WHERE id = %s", values)
    conn.commit()
    cur.close()
    conn.close()


# ── Pub/Sub ───────────────────────────────────────────────────────────────────

def publish_status(job_id: str, status: str, message: str):
    try:
        publisher = pubsub_v1.PublisherClient()
        topic = f"projects/{os.getenv('GCP_PROJECT')}/topics/job-status"
        publisher.publish(
            topic,
            json.dumps({"job_id": job_id, "status": status, "message": message}).encode(),
        )
    except Exception:
        pass


# ── GCS helpers ───────────────────────────────────────────────────────────────

def download_from_gcs(gcs_path: str, local_path: str):
    client = storage.Client()
    client.bucket(os.getenv("GCS_BUCKET")).blob(gcs_path).download_to_filename(local_path)


# ── PostGIS helpers ───────────────────────────────────────────────────────────

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


def push_to_postgis(gdf: gpd.GeoDataFrame, schema: str, table: str):
    from sqlalchemy import text
    engine = _build_engine()
    with engine.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        conn.commit()
    gdf.to_postgis(table, engine, schema=schema, if_exists="replace", index=False)


def load_from_postgis(schema: str, table: str) -> gpd.GeoDataFrame:
    engine = _build_engine()
    return gpd.read_postgis(
        f'SELECT * FROM "{schema}"."{table}"',
        engine,
        geom_col="geometry",
    )


def drop_postgis_table(schema: str, table: str):
    from sqlalchemy import text
    engine = _build_engine()
    with engine.connect() as conn:
        conn.execute(text(f'DROP TABLE IF EXISTS "{schema}"."{table}" CASCADE'))
        conn.commit()


# ── Geometry helpers ──────────────────────────────────────────────────────────

def repair_geometry(gdf: gpd.GeoDataFrame) -> tuple:
    fixed_count = 0
    repaired = []
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            repaired.append(geom)
            continue
        if not geom.is_valid:
            fixed = make_valid(geom)
            if fixed.geom_type == "GeometryCollection":
                polys = [g for g in fixed.geoms
                         if g.geom_type in ("Polygon", "MultiPolygon")]
                fixed = (MultiPolygon(polys) if len(polys) > 1
                         else (polys[0] if polys else geom))
            repaired.append(fixed)
            fixed_count += 1
        else:
            repaired.append(geom)
    gdf = gdf.copy()
    gdf.geometry = repaired
    return gdf, fixed_count


def read_shapefile(zip_path: str) -> gpd.GeoDataFrame:
    try:
        return gpd.read_file(f"zip://{zip_path}")
    except Exception:
        with tempfile.TemporaryDirectory() as tmpdir:
            with zipfile.ZipFile(zip_path, "r") as z:
                z.extractall(tmpdir)
            shp_files = [
                os.path.join(root, f)
                for root, _, files in os.walk(tmpdir)
                for f in files
                if f.endswith(".shp")
            ]
            if not shp_files:
                raise ValueError("No .shp file found in zip")
            return gpd.read_file(shp_files[0])


def get_area_ha(gdf: gpd.GeoDataFrame) -> float:
    try:
        utm = gdf.estimate_utm_crs()
        return round(float(gdf.to_crs(utm).geometry.area.sum()) / 10000, 2)
    except Exception:
        return 0.0


def get_geometry_type(gdf: gpd.GeoDataFrame) -> str:
    types = gdf.geometry.geom_type.unique().tolist()
    return types[0] if len(types) == 1 else "Mixed"


def table_name_for(vector_id: str) -> str:
    return f"vec_{vector_id.replace('-', '_')}"


# ── Endpoints ─────────────────────────────────────────────────────────────────

class IngestJob(BaseModel):
    job_id: str
    vector_id: str
    gcs_path: str
    filename: str


class TransformJob(BaseModel):
    job_id: str
    vector_id: str
    target_epsg: str   # e.g. "32614"


@app.get("/health")
def health():
    return {"status": "ok", "service": "vector-worker"}


@app.post("/ingest")
async def ingest_vector(job: IngestJob):
    update_job(job.job_id, "running", "Downloading file...")
    publish_status(job.job_id, "running", "Downloading file...")

    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, job.filename)

        try:
            download_from_gcs(job.gcs_path, zip_path)

            update_job(job.job_id, "running", "Reading shapefile...")
            gdf = read_shapefile(zip_path)

            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:4326")
            epsg = str(gdf.crs.to_epsg()) if gdf.crs.to_epsg() else str(gdf.crs)

            invalid_count = int((~gdf.geometry.is_valid).sum())
            fixed_count = 0
            if invalid_count > 0:
                update_job(job.job_id, "running",
                           f"Repairing {invalid_count} invalid geometries...")
                gdf, fixed_count = repair_geometry(gdf)
                gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()]

            geometry_type = get_geometry_type(gdf)

            update_job(job.job_id, "running", "Calculating area...")
            area_ha = get_area_ha(gdf)

            update_job(job.job_id, "running", "Saving to PostGIS...")
            tbl = table_name_for(job.vector_id)
            push_to_postgis(gdf, "vectors", tbl)

            # Publish to GeoServer (best-effort — non-fatal)
            geoserver_layer = None
            try:
                update_job(job.job_id, "running", "Publishing to GeoServer...")
                geoserver_layer = publish_vector_layer(job.vector_id, tbl, epsg)
            except Exception as geo_err:
                print(f"GeoServer publish skipped: {geo_err}")

            repair_note = f" ({fixed_count} geometries repaired)" if fixed_count else ""
            update_vector(
                job.vector_id,
                status="ready",
                epsg=epsg,
                geometry_type=geometry_type,
                area_ha=area_ha,
                geoserver_layer=geoserver_layer,
            )

            msg = f"Ingest complete{repair_note}"
            update_job(job.job_id, "done", msg)
            publish_status(job.job_id, "done", msg)

            return {
                "status": "done",
                "epsg": epsg,
                "geometry_type": geometry_type,
                "area_ha": area_ha,
                "features": len(gdf),
                "geometries_repaired": fixed_count,
                "geoserver_layer": geoserver_layer,
            }

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            update_vector(job.vector_id, status="failed")
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/transform")
async def transform_vector(job: TransformJob):
    """
    Reproject an existing vector to a new CRS.
    Loads the PostGIS table, reprojects via gdf.to_crs(), replaces the table,
    re-registers the GeoServer layer, and updates DB metadata.
    """
    update_job(job.job_id, "running", "Starting vector transform...")
    publish_status(job.job_id, "running", "Starting vector transform...")

    try:
        tbl = table_name_for(job.vector_id)

        # 1. Load from PostGIS
        update_job(job.job_id, "running", "Loading from PostGIS...")
        gdf = load_from_postgis("vectors", tbl)

        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")

        # 2. Reproject
        update_job(job.job_id, "running", f"Reprojecting to EPSG:{job.target_epsg}...")
        target_crs = f"EPSG:{job.target_epsg}"
        gdf = gdf.to_crs(target_crs)

        new_epsg = str(gdf.crs.to_epsg()) if gdf.crs.to_epsg() else job.target_epsg
        area_ha  = get_area_ha(gdf)

        # 3. Replace PostGIS table (same name — just replace in-place)
        update_job(job.job_id, "running", "Saving reprojected data to PostGIS...")
        push_to_postgis(gdf, "vectors", tbl)

        # 4. Re-publish GeoServer layer (best-effort — non-fatal)
        geoserver_layer = None
        try:
            update_job(job.job_id, "running", "Updating GeoServer layer...")
            from geoserver import delete_vector_layer
            delete_vector_layer(job.vector_id)
            geoserver_layer = publish_vector_layer(job.vector_id, tbl, new_epsg)
        except Exception as geo_err:
            print(f"GeoServer publish skipped: {geo_err}")

        # 5. Update DB
        update_vector(
            job.vector_id,
            status="ready",
            epsg=new_epsg,
            area_ha=area_ha,
            geoserver_layer=geoserver_layer,
        )

        msg = f"Transform complete → EPSG:{new_epsg}"
        update_job(job.job_id, "done", msg)
        publish_status(job.job_id, "done", msg)

        return {
            "status": "done",
            "epsg": new_epsg,
            "area_ha": area_ha,
            "geoserver_layer": geoserver_layer,
        }

    except Exception as e:
        update_job(job.job_id, "failed", str(e))
        publish_status(job.job_id, "failed", str(e))
        update_vector(job.vector_id, status="failed")
        raise HTTPException(status_code=500, detail=str(e))
