import os
import json
import tempfile
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from google.cloud import storage, pubsub_v1
import psycopg2
import psycopg2.extras

load_dotenv()

app = FastAPI(title="Timbermap Raster Worker")

# ── Helpers ───────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor
    )

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

def update_image(image_id: str, **kwargs):
    if not kwargs:
        return
    fields = ', '.join(f"{k} = %s" for k in kwargs)
    values = list(kwargs.values()) + [image_id]
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"UPDATE images SET {fields} WHERE id = %s", values)
    conn.commit()
    cur.close()
    conn.close()

def publish_status(job_id: str, status: str, message: str):
    try:
        publisher = pubsub_v1.PublisherClient()
        topic = f"projects/{os.getenv('GCP_PROJECT')}/topics/job-status"
        publisher.publish(topic, json.dumps({
            "job_id": job_id, "status": status, "message": message
        }).encode())
    except Exception:
        pass  # Non-fatal if pubsub not set up yet

def download_from_gcs(gcs_path: str, local_path: str):
    client = storage.Client()
    bucket = client.bucket(os.getenv("GCS_BUCKET"))
    blob = bucket.blob(gcs_path)
    blob.download_to_filename(local_path)

def upload_to_gcs(local_path: str, gcs_path: str):
    client = storage.Client()
    bucket = client.bucket(os.getenv("GCS_BUCKET"))
    blob = bucket.blob(gcs_path)
    blob.upload_from_filename(local_path)

# ── Raster processing ─────────────────────────────────────

def extract_metadata(tif_path: str) -> dict:
    import rasterio
    with rasterio.open(tif_path) as src:
        epsg = src.crs.to_epsg() if src.crs else None
        num_bands = src.count
        pixel_x = abs(src.transform.a)
        pixel_y = abs(src.transform.e)
        width = src.width
        height = src.height

        # Calculate area in hectares
        if epsg == 4326:
            area_ha = round(
                111320 * 111320 * pixel_x * pixel_y * width * height / 10000, 2
            )
        else:
            area_ha = round(pixel_x * pixel_y * width * height / 10000, 2)

        return {
            "epsg": str(epsg) if epsg else None,
            "num_bands": num_bands,
            "pixel_size_x": pixel_x,
            "pixel_size_y": pixel_y,
            "area_ha": area_ha,
        }

def generate_thumbnail(tif_path: str, thumb_path: str, size: int = 256):
    import rasterio
    from rasterio.enums import Resampling
    from PIL import Image

    with rasterio.open(tif_path) as src:
        scale = min(size / src.width, size / src.height)
        new_w = max(1, int(src.width * scale))
        new_h = max(1, int(src.height * scale))

        if src.count >= 3:
            data = src.read([1, 2, 3], out_shape=(3, new_h, new_w),
                           resampling=Resampling.average)
            img_array = np.moveaxis(data, 0, -1)
        else:
            data = src.read(1, out_shape=(new_h, new_w),
                           resampling=Resampling.average)
            img_array = np.stack([data, data, data], axis=-1)

        # Normalize to 0-255
        img_min, img_max = img_array.min(), img_array.max()
        if img_max > img_min:
            img_array = ((img_array - img_min) / (img_max - img_min) * 255)
        img_array = img_array.astype(np.uint8)

        img = Image.fromarray(img_array, 'RGB')
        img.save(thumb_path, 'JPEG', quality=85)

def convert_to_cog(input_path: str, output_path: str):
    import rasterio
    from rasterio.shutil import copy as rio_copy
    rio_copy(input_path, output_path,
             driver='GTiff',
             compress='LZW',
             tiled=True,
             blockxsize=512,
             blockysize=512,
             copy_src_overviews=True)

# ── Job handler ───────────────────────────────────────────

class IngestJob(BaseModel):
    job_id: str
    image_id: str
    gcs_path: str
    filename: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "raster-worker"}

@app.post("/ingest")
async def ingest_raster(job: IngestJob):
    update_job(job.job_id, "running", "Downloading file...")
    publish_status(job.job_id, "running", "Downloading file...")

    with tempfile.TemporaryDirectory() as tmpdir:
        tif_path = os.path.join(tmpdir, job.filename)
        cog_path = os.path.join(tmpdir, "cog_" + job.filename)
        thumb_path = os.path.join(tmpdir, "thumb.jpg")

        try:
            # 1. Download from GCS
            download_from_gcs(job.gcs_path, tif_path)

            # 2. Extract metadata
            update_job(job.job_id, "running", "Reading metadata...")
            meta = extract_metadata(tif_path)

            # 3. Generate thumbnail
            update_job(job.job_id, "running", "Generating thumbnail...")
            generate_thumbnail(tif_path, thumb_path)
            thumb_gcs = f"users/thumbnails/{job.image_id}.jpg"
            upload_to_gcs(thumb_path, thumb_gcs)

            # 4. Convert to COG
            update_job(job.job_id, "running", "Converting to COG...")
            convert_to_cog(tif_path, cog_path)
            cog_gcs = f"users/cogs/{job.image_id}.tif"
            upload_to_gcs(cog_path, cog_gcs)

            # 5. Update DB
            update_image(job.image_id,
                status="ready",
                epsg=meta["epsg"],
                num_bands=meta["num_bands"],
                pixel_size_x=meta["pixel_size_x"],
                pixel_size_y=meta["pixel_size_y"],
                area_ha=meta["area_ha"],
            )

            update_job(job.job_id, "done", "Ingest complete")
            publish_status(job.job_id, "done", "Ingest complete")

            return {"status": "done", "meta": meta}

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            update_image(job.image_id, status="failed")
            raise HTTPException(status_code=500, detail=str(e))
