"""
workers/raster/main.py
Raster ingest + COG worker — memory-optimized via GDAL disk-based processing.
"""

import os
import json
import tempfile
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from google.cloud import storage, pubsub_v1
import psycopg2
import psycopg2.extras

load_dotenv()

app = FastAPI(title="Timbermap Raster Worker")

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


def update_job(job_id: str, status: str, message: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE jobs
        SET status      = %s,
            message     = %s,
            started_at  = CASE WHEN status = 'queued' THEN NOW() ELSE started_at END,
            finished_at = CASE WHEN %s IN ('done','failed') THEN NOW() ELSE NULL END
        WHERE id = %s
        """,
        (status, message, status, job_id),
    )
    conn.commit()
    cur.close()
    conn.close()


def update_image(image_id: str, **kwargs):
    if not kwargs:
        return
    fields = ", ".join(f"{k} = %s" for k in kwargs)
    values = list(kwargs.values()) + [image_id]
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"UPDATE images SET {fields} WHERE id = %s", values)
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
    storage.Client().bucket(GCS_BUCKET).blob(gcs_path).download_to_filename(local_path)


def upload_to_gcs(local_path: str, gcs_path: str):
    storage.Client().bucket(GCS_BUCKET).blob(gcs_path).upload_from_filename(local_path)


# ── Raster processing ─────────────────────────────────────────────────────────

def extract_metadata(tif_path: str) -> dict:
    """Read metadata without loading pixel data into memory."""
    import rasterio
    from rasterio.warp import transform_bounds
    with rasterio.open(tif_path) as src:
        epsg      = src.crs.to_epsg() if src.crs else None
        num_bands = src.count
        pixel_x   = abs(src.transform.a)
        pixel_y   = abs(src.transform.e)
        width, height = src.width, src.height
        if epsg == 4326:
            area_ha = round(111320 * 111320 * pixel_x * pixel_y * width * height / 10000, 2)
        else:
            area_ha = round(pixel_x * pixel_y * width * height / 10000, 2)
        bounds = src.bounds
        if src.crs and src.crs.to_epsg() != 4326:
            left, bottom, right, top = transform_bounds(
                src.crs, "EPSG:4326",
                bounds.left, bounds.bottom, bounds.right, bounds.top
            )
        else:
            left, bottom, right, top = bounds.left, bounds.bottom, bounds.right, bounds.top
        return {
            "epsg":         str(epsg) if epsg else None,
            "num_bands":    num_bands,
            "pixel_size_x": pixel_x,
            "pixel_size_y": pixel_y,
            "area_ha":      area_ha,
            "bbox":         {"minx": left, "miny": bottom, "maxx": right, "maxy": top},
        }


def strip_alpha_gdal(input_path: str, output_path: str) -> str:
    """
    If input has 4 bands, strip the alpha band using gdal_translate
    (disk-based, no full array in RAM).
    Returns output_path if stripped, input_path if not needed.
    """
    from osgeo import gdal
    gdal.UseExceptions()
    ds = gdal.Open(input_path)
    if ds is None:
        raise RuntimeError(f"Cannot open {input_path}")
    num_bands = ds.RasterCount
    ds = None  # close

    if num_bands != 4:
        return input_path

    # Use gdal_translate to select only bands 1,2,3 — purely disk-based
    opts = gdal.TranslateOptions(
        bandList=[1, 2, 3],
        format="GTiff",
        creationOptions=["COMPRESS=LZW", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
    )
    result = gdal.Translate(output_path, input_path, options=opts)
    if result is None:
        raise RuntimeError(f"gdal.Translate strip alpha failed for {input_path}")
    result.FlushCache()
    result = None
    return output_path


def generate_thumbnail(tif_path: str, thumb_path: str, size: int = 256):
    """
    Generate thumbnail by reading a heavily downsampled version — low memory usage.
    Uses rasterio overview reading which doesn't load the full raster.
    """
    import rasterio
    from rasterio.enums import Resampling
    from PIL import Image

    with rasterio.open(tif_path) as src:
        # Calculate scale factor — read at thumbnail size only
        scale = min(size / src.width, size / src.height)
        new_w = max(1, int(src.width * scale))
        new_h = max(1, int(src.height * scale))

        # Read only at the target size — rasterio handles the downsampling
        # without loading the full raster into memory
        if src.count >= 3:
            data = src.read(
                [1, 2, 3],
                out_shape=(3, new_h, new_w),
                resampling=Resampling.average
            )
            img_array = np.moveaxis(data, 0, -1)
        else:
            data = src.read(
                1,
                out_shape=(1, new_h, new_w),
                resampling=Resampling.average
            )
            img_array = np.stack([data[0], data[0], data[0]], axis=-1)

        # Normalize to 0-255
        img_min, img_max = float(img_array.min()), float(img_array.max())
        if img_max > img_min:
            img_array = ((img_array - img_min) / (img_max - img_min) * 255)
        img_array = img_array.astype(np.uint8)
        Image.fromarray(img_array, "RGB").save(thumb_path, "JPEG", quality=85)


def convert_to_cog(input_path: str, output_path: str):
    """
    Convert to Cloud-Optimized GeoTIFF in EPSG:3857.
    Uses gdal.Warp with COG driver — fully disk-based, minimal RAM.
    Strips alpha band first if present (also disk-based via gdal.Translate).
    """
    from osgeo import gdal
    gdal.UseExceptions()

    # Step 1: strip alpha band if needed (disk-based)
    stripped_path = input_path + "_rgb.tif"
    working_path = strip_alpha_gdal(input_path, stripped_path)

    # Step 2: warp to EPSG:3857 + write as COG in one pass
    # GDAL COG driver handles tiling + overviews internally without
    # loading the full raster into RAM
    warp_opts = gdal.WarpOptions(
        dstSRS="EPSG:3857",
        resampleAlg=gdal.GRA_Bilinear,
        format="COG",
        creationOptions=[
            "BLOCKSIZE=256",
            "TILING_SCHEME=GoogleMapsCompatible",
            "COMPRESS=DEFLATE",
            "OVERVIEWS=IGNORE_EXISTING",
            "NUM_THREADS=ALL_CPUS",   # use all CPUs for faster processing
        ],
        dstAlpha=True,
        warpOptions=["INIT_DEST=255,255,255,0"],
        warpMemoryLimit=512,          # limit GDAL warp memory to 512MB
        multithread=True,
    )
    result = gdal.Warp(output_path, working_path, options=warp_opts)
    if result is None:
        raise RuntimeError(f"gdal.Warp COG conversion failed for {working_path}")
    result.FlushCache()
    result = None

    # Clean up stripped file if created
    if working_path != input_path and os.path.exists(working_path):
        os.remove(working_path)


def warp_raster(input_path: str, output_path: str,
                target_epsg: str, target_resolution_m: Optional[float] = None):
    """Reproject raster — disk-based via gdal.Warp."""
    from osgeo import gdal
    gdal.UseExceptions()
    warp_opts = gdal.WarpOptions(
        dstSRS=f"EPSG:{target_epsg}",
        xRes=target_resolution_m,
        yRes=target_resolution_m,
        resampleAlg=gdal.GRA_Bilinear,
        creationOptions=["COMPRESS=LZW", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
        format="GTiff",
        warpMemoryLimit=512,
        multithread=True,
    )
    result = gdal.Warp(output_path, input_path, options=warp_opts)
    if result is None:
        raise RuntimeError(f"gdal.Warp failed for {input_path}")
    result.FlushCache()
    result = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

class IngestJob(BaseModel):
    job_id: str
    image_id: str
    gcs_path: str
    filename: str


class TransformJob(BaseModel):
    job_id: str
    image_id: str
    target_epsg: str
    target_resolution_m: Optional[float] = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "raster-worker"}


@app.post("/ingest")
async def ingest_raster(job: IngestJob):
    update_job(job.job_id, "running", "Downloading file...")
    publish_status(job.job_id, "running", "Downloading file...")

    with tempfile.TemporaryDirectory() as tmpdir:
        tif_path   = os.path.join(tmpdir, job.filename)
        cog_path   = os.path.join(tmpdir, "cog_" + job.filename)
        thumb_path = os.path.join(tmpdir, "thumb.jpg")

        try:
            download_from_gcs(job.gcs_path, tif_path)

            update_job(job.job_id, "running", "Reading metadata...")
            meta = extract_metadata(tif_path)

            update_job(job.job_id, "running", "Generating thumbnail...")
            generate_thumbnail(tif_path, thumb_path)
            upload_to_gcs(thumb_path, f"users/thumbnails/{job.image_id}.jpg")

            update_job(job.job_id, "running", "Converting to COG (EPSG:3857)...")
            convert_to_cog(tif_path, cog_path)
            upload_to_gcs(cog_path, f"users/cogs/{job.image_id}.tif")

            bbox = meta.get("bbox", {})
            update_image(
                job.image_id,
                status="ready",
                epsg=meta["epsg"],
                num_bands=meta["num_bands"],
                pixel_size_x=meta["pixel_size_x"],
                pixel_size_y=meta["pixel_size_y"],
                area_ha=meta["area_ha"],
                geoserver_layer=None,
                bbox_minx=bbox.get("minx"),
                bbox_miny=bbox.get("miny"),
                bbox_maxx=bbox.get("maxx"),
                bbox_maxy=bbox.get("maxy"),
            )

            update_job(job.job_id, "done", "Ingest complete")
            publish_status(job.job_id, "done", "Ingest complete")
            return {"status": "done", "meta": meta}

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            update_image(job.image_id, status="failed")
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/transform")
async def transform_raster(job: TransformJob):
    update_job(job.job_id, "running", "Starting raster transform...")
    publish_status(job.job_id, "running", "Starting raster transform...")

    with tempfile.TemporaryDirectory() as tmpdir:
        src_path    = os.path.join(tmpdir, "source.tif")
        warped_path = os.path.join(tmpdir, "warped.tif")
        cog_path    = os.path.join(tmpdir, "cog.tif")

        try:
            update_job(job.job_id, "running", "Downloading current raster...")
            download_from_gcs(f"users/cogs/{job.image_id}.tif", src_path)

            update_job(job.job_id, "running", f"Reprojecting to EPSG:{job.target_epsg}...")
            warp_raster(src_path, warped_path, job.target_epsg, job.target_resolution_m)

            # Extract metadata from warped file before COG conversion
            meta_warped = extract_metadata(warped_path)

            update_job(job.job_id, "running", "Converting to COG (EPSG:3857)...")
            convert_to_cog(warped_path, cog_path)
            upload_to_gcs(cog_path, f"users/cogs/{job.image_id}.tif")

            meta = extract_metadata(cog_path)
            bbox = meta.get("bbox", {})
            update_image(
                job.image_id,
                status="ready",
                epsg=meta_warped["epsg"],
                num_bands=meta["num_bands"],
                pixel_size_x=meta["pixel_size_x"],
                pixel_size_y=meta["pixel_size_y"],
                area_ha=meta["area_ha"],
                geoserver_layer=None,
                bbox_minx=bbox.get("minx"),
                bbox_miny=bbox.get("miny"),
                bbox_maxx=bbox.get("maxx"),
                bbox_maxy=bbox.get("maxy"),
            )

            msg = f"Transform complete → EPSG:{job.target_epsg}" + \
                  (f" @ {job.target_resolution_m}m" if job.target_resolution_m else "")
            update_job(job.job_id, "done", msg)
            publish_status(job.job_id, "done", msg)
            return {"status": "done", "meta": meta}

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            update_image(job.image_id, status="failed")
            raise HTTPException(status_code=500, detail=str(e))
