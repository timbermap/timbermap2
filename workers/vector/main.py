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

load_dotenv()

app = FastAPI(title="Timbermap Vector Worker")

def update_job(job_id: str, status: str, message: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE jobs SET status = %s, message = %s,
        started_at = CASE WHEN status = 'queued' THEN NOW() ELSE started_at END,
        finished_at = CASE WHEN %s IN ('done','failed') THEN NOW() ELSE NULL END
        WHERE id = %s
    """, (status, message, status, job_id))
    conn.commit()
    cur.close()
    conn.close()

def update_vector(vector_id: str, **kwargs):
    if not kwargs:
        return
    fields = ', '.join(f"{k} = %s" for k in kwargs)
    values = list(kwargs.values()) + [vector_id]
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"UPDATE vectors SET {fields} WHERE id = %s", values)
    conn.commit()
    cur.close()
    conn.close()

def push_to_postgis(gdf: gpd.GeoDataFrame, schema: str, table: str):
    from sqlalchemy import create_engine, text
    host = os.getenv("DB_HOST", "127.0.0.1")
    password = os.getenv("DB_PASSWORD")
    dbname = os.getenv("DB_NAME", "timbermap")
    user = os.getenv("DB_USER", "postgres")
    if host.startswith("/cloudsql"):
        url = f"postgresql+psycopg2://{user}:{password}@/{dbname}?host={host}"
    else:
        port = os.getenv("DB_PORT", "5432")
        url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"
    engine = create_engine(url)
    with engine.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        conn.commit()
    gdf.to_postgis(table, engine, schema=schema, if_exists="replace", index=False)

def publish_status(job_id: str, status: str, message: str):
    try:
        publisher = pubsub_v1.PublisherClient()
        topic = f"projects/{os.getenv('GCP_PROJECT')}/topics/job-status"
        publisher.publish(topic, json.dumps({
            "job_id": job_id, "status": status, "message": message
        }).encode())
    except Exception:
        pass

def download_from_gcs(gcs_path: str, local_path: str):
    client = storage.Client()
    bucket = client.bucket(os.getenv("GCS_BUCKET"))
    blob = bucket.blob(gcs_path)
    blob.download_to_filename(local_path)

def repair_geometry(gdf: gpd.GeoDataFrame) -> tuple:
    fixed_count = 0
    repaired = []
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            repaired.append(geom)
            continue
        if not geom.is_valid:
            fixed = make_valid(geom)
            if fixed.geom_type == 'GeometryCollection':
                polys = [g for g in fixed.geoms
                         if g.geom_type in ('Polygon', 'MultiPolygon')]
                fixed = MultiPolygon(polys) if len(polys) > 1 else (polys[0] if polys else geom)
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
            with zipfile.ZipFile(zip_path, 'r') as z:
                z.extractall(tmpdir)
            shp_files = []
            for root, dirs, files in os.walk(tmpdir):
                for f in files:
                    if f.endswith('.shp'):
                        shp_files.append(os.path.join(root, f))
            if not shp_files:
                raise ValueError("No .shp file found in zip")
            return gpd.read_file(shp_files[0])

def get_area_ha(gdf: gpd.GeoDataFrame) -> float:
    try:
        utm = gdf.estimate_utm_crs()
        projected = gdf.to_crs(utm)
        return round(float(projected.geometry.area.sum()) / 10000, 2)
    except Exception:
        return 0.0

def get_geometry_type(gdf: gpd.GeoDataFrame) -> str:
    types = gdf.geometry.geom_type.unique().tolist()
    return types[0] if len(types) == 1 else "Mixed"

class IngestJob(BaseModel):
    job_id: str
    vector_id: str
    gcs_path: str
    filename: str

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
            if invalid_count > 0:
                update_job(job.job_id, "running",
                    f"Repairing {invalid_count} invalid geometries...")
                gdf, fixed_count = repair_geometry(gdf)
                gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()]
            else:
                fixed_count = 0

            geometry_type = get_geometry_type(gdf)

            update_job(job.job_id, "running", "Calculating area...")
            area_ha = get_area_ha(gdf)

            update_job(job.job_id, "running", "Saving to PostGIS...")
            table_name = f"vec_{job.vector_id.replace('-', '_')}"
            push_to_postgis(gdf, "vectors", table_name)

            repair_note = f" ({fixed_count} geometries repaired)" if fixed_count > 0 else ""
            update_vector(job.vector_id,
                status="ready",
                epsg=epsg,
                geometry_type=geometry_type,
                area_ha=area_ha,
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
            }

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            update_vector(job.vector_id, status="failed")
            raise HTTPException(status_code=500, detail=str(e))
