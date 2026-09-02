"""
workers/raster/main.py
Raster ingest + COG worker — memory-optimized via GDAL disk-based processing.
For large files (>1GB): reads directly from GCS via /vsigs/ without downloading.
"""

import os
import json
import math
import logging
import tempfile
import numpy as np
from fastapi import FastAPI, HTTPException, BackgroundTasks
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from google.cloud import storage, pubsub_v1
import psycopg2
import psycopg2.extras

load_dotenv()

app = FastAPI(title="Timbermap Raster Worker")

GCS_BUCKET     = os.getenv("GCS_BUCKET", "timbermap-data")
GCP_PROJECT    = os.getenv("GCP_PROJECT", "timbermap-prod")

# Configure GDAL for GCS access via /vsigs/ using GCE metadata server
from osgeo import gdal as _gdal
_gdal.UseExceptions()
_gdal.SetConfigOption("CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE", "YES")
_gdal.SetConfigOption("GDAL_HTTP_TIMEOUT", "120")
_gdal.SetConfigOption("CPL_GCE_CREDENTIALS_URL",
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token")

# Files larger than this are processed directly from GCS via /vsigs/
LARGE_FILE_THRESHOLD_BYTES = 500 * 1024 * 1024  # 500 MB


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


def is_cancelled(job_id: str) -> bool:
    try:
        conn = get_conn()
        cur  = conn.cursor()
        cur.execute("SELECT status FROM jobs WHERE id = %s", (job_id,))
        row  = cur.fetchone()
        cur.close(); conn.close()
        return bool(row and row["status"] == "cancelled")
    except Exception:
        return False


def update_job_summary(job_id: str, summary: dict):
    import json as _json
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE jobs SET summary = %s WHERE id = %s", (_json.dumps(summary), job_id))
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
        topic = f"projects/{GCP_PROJECT}/topics/job-status"
        publisher.publish(
            topic,
            json.dumps({"job_id": job_id, "status": status, "message": message}).encode(),
        )
    except Exception:
        pass


# ── GCS helpers ───────────────────────────────────────────────────────────────

def get_gcs_file_size(gcs_path: str) -> int:
    """Returns file size in bytes without downloading."""
    blob = storage.Client().bucket(GCS_BUCKET).blob(gcs_path)
    blob.reload()
    return blob.size or 0


def download_from_gcs(gcs_path: str, local_path: str):
    """Download from GCS using large chunk size for faster transfer."""
    blob = storage.Client().bucket(GCS_BUCKET).blob(gcs_path)
    blob.chunk_size = 32 * 1024 * 1024  # 32MB chunks
    blob.download_to_filename(local_path)


def upload_to_gcs(local_path: str, gcs_path: str):
    storage.Client().bucket(GCS_BUCKET).blob(gcs_path).upload_from_filename(local_path)


def vsigs_path(gcs_path: str) -> str:
    """Returns GDAL virtual filesystem path for direct GCS access."""
    return f"/vsigs/{GCS_BUCKET}/{gcs_path}"


# ── Raster processing ─────────────────────────────────────────────────────────

def extract_metadata(tif_path: str) -> dict:
    """Read metadata without loading pixel data into memory.
    Works with both local paths and /vsigs/ paths."""
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
    """Strip alpha band using gdal_translate — disk-based."""
    from osgeo import gdal
    gdal.UseExceptions()
    ds = gdal.Open(input_path)
    if ds is None:
        raise RuntimeError(f"Cannot open {input_path}")
    num_bands = ds.RasterCount
    ds = None

    if num_bands != 4:
        return input_path

    opts = gdal.TranslateOptions(
        bandList=[1, 2, 3],
        format="GTiff",
        creationOptions=["COMPRESS=LZW", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512", "BIGTIFF=YES"],
    )
    result = gdal.Translate(output_path, input_path, options=opts)
    if result is None:
        raise RuntimeError(f"gdal.Translate strip alpha failed for {input_path}")
    result.FlushCache()
    result = None
    return output_path


def generate_thumbnail(tif_path: str, thumb_path: str, size: int = 256):
    """Generate thumbnail from a local COG file (has internal overviews — always fast)."""
    import rasterio
    from rasterio.enums import Resampling
    from PIL import Image

    with rasterio.open(tif_path) as src:
        scale = min(size / src.width, size / src.height)
        new_w = max(1, int(src.width * scale))
        new_h = max(1, int(src.height * scale))

        if src.count >= 3:
            data = src.read([1, 2, 3], out_shape=(3, new_h, new_w),
                            resampling=Resampling.nearest)
            img_array = np.moveaxis(data, 0, -1)
        else:
            data = src.read(1, out_shape=(1, new_h, new_w),
                            resampling=Resampling.nearest)
            img_array = np.stack([data[0], data[0], data[0]], axis=-1)

        img_array = img_array.astype(np.float32)
        mn, mx = float(img_array.min()), float(img_array.max())
        if mx > mn:
            img_array = (img_array - mn) / (mx - mn) * 255
        Image.fromarray(img_array.astype(np.uint8), "RGB").save(thumb_path, "JPEG", quality=85)


def convert_to_cog(input_path: str, output_path: str, extra_warp_args: Optional[list] = None):
    """Convert raster to Cloud-Optimized GeoTIFF in EPSG:3857 using subprocess.

    input_path can be a local path or a /vsigs/ GCS path.
    Uses subprocess GDAL tools to avoid Python heap memory pressure.
    Passes GCS auth env vars so subprocesses can read /vsigs/ paths.
    extra_warp_args lets callers fold a resolution override (e.g. "-tr" for
    a transform request) into this single warp instead of resampling twice.
    """
    import subprocess
    from osgeo import gdal
    gdal.UseExceptions()

    # Env vars for subprocess GCS access via /vsigs/
    gdal_env = os.environ.copy()
    gdal_env.update({
        "CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE": "YES",
        "GDAL_HTTP_TIMEOUT": "300",
        "CPL_GCE_CREDENTIALS_URL": (
            "http://metadata.google.internal/computeMetadata/v1/"
            "instance/service-accounts/default/token"
        ),
    })

    # Detect data bands — exclude alpha bands, keep all spectral bands
    ds = gdal.Open(input_path)
    if ds is None:
        raise RuntimeError(f"Cannot open {input_path}")
    nbands = ds.RasterCount
    data_bands = [
        i for i in range(1, nbands + 1)
        if ds.GetRasterBand(i).GetColorInterpretation() != gdal.GCI_AlphaBand
    ]
    ds = None

    if not data_bands:
        data_bands = [1]  # fallback

    band_args = []
    for b in data_bands:
        band_args += ["-b", str(b)]

    is_vsigs = input_path.startswith("/vsigs/")

    # Step 1: reproject to EPSG:3857 (required for map tile rendering)
    # Output is always local — /tmp has 32GB on gen2
    warped_path = os.path.join(tempfile.gettempdir(), os.path.basename(output_path) + "_3857.tif")
    cmd_warp = [
        "gdalwarp",
        "-t_srs", "EPSG:3857",
        "-r", "bilinear",
        "-of", "GTiff",
        "-co", "COMPRESS=DEFLATE",
        "-co", "TILED=YES",
        "-co", "BLOCKXSIZE=512",
        "-co", "BLOCKYSIZE=512",
        "-co", "BIGTIFF=YES",
        "-wm", "512",
        "-multi",
        "--config", "GDAL_CACHEMAX", "256",
    ] + (extra_warp_args or []) + band_args + [input_path, warped_path]

    r1 = subprocess.run(cmd_warp, capture_output=True, text=True, timeout=7200, env=gdal_env)
    if r1.returncode != 0:
        raise RuntimeError(f"gdalwarp reproject failed: {r1.stderr[:500]}")

    # Delete local source to free disk (skip for /vsigs/ — nothing to delete)
    if not is_vsigs and os.path.exists(input_path):
        os.remove(input_path)

    # Step 2: build overviews externally (low RAM — sequential tile reads)
    cmd_addo = [
        "gdaladdo",
        "--config", "GDAL_CACHEMAX", "256",
        "--config", "COMPRESS_OVERVIEW", "DEFLATE",
        "-r", "nearest",
        warped_path,
        "2", "4", "8", "16", "32", "64", "128",
    ]
    r2 = subprocess.run(cmd_addo, capture_output=True, text=True, timeout=7200, env=gdal_env)
    if r2.returncode != 0:
        if os.path.exists(warped_path):
            os.remove(warped_path)
        raise RuntimeError(f"gdaladdo overviews failed: {r2.stderr[:500]}")

    # Step 3: translate to COG reusing prebuilt overviews (no recompute = low RAM)
    cmd_cog = [
        "gdal_translate",
        "-of", "COG",
        "-co", "BLOCKSIZE=256",
        "-co", "COMPRESS=DEFLATE",
        "-co", "OVERVIEWS=FORCE_USE_EXISTING",
        "-co", "BIGTIFF=YES",
        "--config", "GDAL_CACHEMAX", "256",
        warped_path, output_path,
    ]
    r3 = subprocess.run(cmd_cog, capture_output=True, text=True, timeout=7200, env=gdal_env)
    if os.path.exists(warped_path):
        os.remove(warped_path)
    if r3.returncode != 0:
        raise RuntimeError(f"gdal_translate COG failed: {r3.stderr[:500]}")


def generate_display_cog(cog_path: str, display_path: str) -> bool:
    """Lightweight JPEG-compressed COG for map display — ~5-10x smaller than
    the lossless DEFLATE COG, reusing its overviews (no re-warp needed).
    Only safe for 8-bit 1-4 band imagery (JPEG's constraint in the COG
    driver); returns False otherwise so the caller falls back to serving
    the lossless COG unchanged."""
    import subprocess
    from osgeo import gdal
    gdal.UseExceptions()

    ds = gdal.Open(cog_path)
    if ds is None:
        return False
    nbands = ds.RasterCount
    dtype  = ds.GetRasterBand(1).DataType
    ds = None
    if dtype != gdal.GDT_Byte or nbands not in (1, 2, 3, 4):
        return False

    gdal_env = os.environ.copy()
    gdal_env.update({
        "CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE": "YES",
        "GDAL_HTTP_TIMEOUT": "300",
    })
    cmd = [
        "gdal_translate", "-of", "COG",
        "-co", "COMPRESS=JPEG", "-co", "QUALITY=82",
        "-co", "BLOCKSIZE=256",
        "-co", "OVERVIEWS=FORCE_USE_EXISTING",
        "-co", "BIGTIFF=YES",
        "--config", "GDAL_CACHEMAX", "256",
        cog_path, display_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=gdal_env)
    if r.returncode != 0:
        logging.warning("Display COG generation failed for %s: %s", cog_path, r.stderr[:300])
        return False
    return True


def _warp_metadata(input_path: str, target_epsg: Optional[str], target_resolution_m: Optional[float]) -> dict:
    """Metadata-only reprojection via a VRT (no pixel data materialized) —
    reports accurate epsg/pixel-size/area for a transform request without
    paying for a second full-resolution resample of the actual raster."""
    from osgeo import gdal
    gdal.UseExceptions()
    warp_opts = gdal.WarpOptions(
        dstSRS=f"EPSG:{target_epsg}" if target_epsg else None,
        xRes=target_resolution_m,
        yRes=target_resolution_m,
        resampleAlg=gdal.GRA_Bilinear,
        format="VRT",
    )
    with tempfile.TemporaryDirectory() as vrt_dir:
        vrt_path = os.path.join(vrt_dir, "meta.vrt")
        result = gdal.Warp(vrt_path, input_path, options=warp_opts)
        if result is None:
            raise RuntimeError(f"gdal.Warp (metadata VRT) failed for {input_path}")
        result = None
        return extract_metadata(vrt_path)


def _mercator_center_lat(input_path: str) -> float:
    """Center latitude (WGS84 degrees) of a raster, used to correct a true
    ground resolution into the equivalent EPSG:3857 resolution — Web
    Mercator stretches distances by 1/cos(lat) relative to the ground."""
    import rasterio
    from rasterio.warp import transform_bounds
    with rasterio.open(input_path) as src:
        if src.crs and src.crs.to_epsg() != 4326:
            left, bottom, right, top = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
        else:
            left, bottom, right, top = src.bounds
    return (bottom + top) / 2


# ── Endpoints ─────────────────────────────────────────────────────────────────

class IngestJob(BaseModel):
    job_id: str
    image_id: str
    gcs_path: str
    filename: str
    clerk_id: str = ""


class TransformJob(BaseModel):
    job_id: str
    image_id: str
    target_epsg: Optional[str] = None
    target_resolution_m: Optional[float] = None
    clerk_id: str = ""


@app.get("/health")
def health():
    return {"status": "ok", "service": "raster-worker"}


def _do_ingest(job: IngestJob):
    """Background processing — runs after Cloud Tasks already got its 200.
    Reads directly from GCS via /vsigs/ — no download needed."""
    try:
        file_size = get_gcs_file_size(job.gcs_path)
    except Exception as e:
        if "404" in str(e) or "NotFound" in type(e).__name__:
            msg = f"File not found in GCS: {job.gcs_path}"
            logging.error(msg)
            update_job(job.job_id, "failed", msg)
            update_image(job.image_id, status="failed")
            return
        raise

    size_mb = file_size / 1024 / 1024

    with tempfile.TemporaryDirectory() as tmpdir:
        thumb_path = os.path.join(tmpdir, "thumb.jpg")
        cog_path   = os.path.join(tmpdir, "cog.tif")

        try:
            # Download with gsutil -m (parallel, ~1-2 min for 1GB vs 10-15 min with Python client)
            update_job(job.job_id, "running", f"Downloading ({size_mb:.0f} MB)...")
            publish_status(job.job_id, "running", f"Downloading ({size_mb:.0f} MB)...")
            src_path = os.path.join(tmpdir, job.filename)
            download_from_gcs(job.gcs_path, src_path)

            if is_cancelled(job.job_id): return
            update_job(job.job_id, "running", "Reading metadata...")
            meta = extract_metadata(src_path)

            if is_cancelled(job.job_id): return
            update_job(job.job_id, "running", f"Converting to COG ({size_mb:.0f} MB)...")
            publish_status(job.job_id, "running", f"Converting to COG ({size_mb:.0f} MB)...")
            cog_gcs_dest = f"users/{job.clerk_id}/cogs/{job.image_id}.tif"
            convert_to_cog(src_path, cog_path)
            upload_to_gcs(cog_path, cog_gcs_dest)

            # Thumbnail from local COG (has overviews) — always fast
            update_job(job.job_id, "running", "Generating thumbnail...")
            generate_thumbnail(cog_path if os.path.exists(cog_path) else src_path, thumb_path)
            upload_to_gcs(thumb_path, f"users/{job.clerk_id}/thumbnails/{job.image_id}.jpg")

            # Lightweight display COG for map viewing — non-fatal if skipped
            display_path = os.path.join(tmpdir, "display.tif")
            has_display = generate_display_cog(cog_path, display_path)
            if has_display:
                upload_to_gcs(display_path, f"users/{job.clerk_id}/cogs_display/{job.image_id}.tif")

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
                has_display_cog=has_display,
            )

            update_job(job.job_id, "done", "Ingest complete")
            publish_status(job.job_id, "done", "Ingest complete")

        except Exception as e:
            msg = str(e)
            logging.error("Ingest failed for job %s: %s", job.job_id, msg)
            update_job(job.job_id, "failed", msg)
            publish_status(job.job_id, "failed", msg)
            update_image(job.image_id, status="failed")


@app.post("/ingest")
async def ingest_raster(job: IngestJob, background_tasks: BackgroundTasks):
    """Accept immediately — Cloud Tasks gets 200 right away, no 30-min timeout."""
    update_job(job.job_id, "running", "Accepted — processing in background...")
    publish_status(job.job_id, "running", "Accepted — processing in background...")
    background_tasks.add_task(_do_ingest, job)
    return {"status": "accepted"}


def _do_transform(job: TransformJob):
    """Background processing for transform."""
    try:
        update_job(job.job_id, "running", "Checking file size...")
        publish_status(job.job_id, "running", "Starting raster transform...")

        cog_gcs_path = f"users/{job.clerk_id}/cogs/{job.image_id}.tif"
        file_size    = get_gcs_file_size(cog_gcs_path)
        size_mb      = file_size / 1024 / 1024

        with tempfile.TemporaryDirectory() as tmpdir:
            cog_path = os.path.join(tmpdir, "cog.tif")

            # Always download locally for transform — vsigs streaming breaks on long warp operations
            update_job(job.job_id, "running", f"Downloading ({size_mb:.0f} MB)...")
            src_path = os.path.join(tmpdir, "source.tif")
            download_from_gcs(cog_gcs_path, src_path)

            if is_cancelled(job.job_id): return

            # Auto-select UTM if metric resolution requested but CRS is geographic (degrees)
            target_epsg = job.target_epsg
            center_lat = _mercator_center_lat(src_path)
            if job.target_resolution_m:
                import rasterio
                with rasterio.open(src_path) as ds:
                    crs = ds.crs
                    is_geographic = crs.is_geographic if crs else False
                    if is_geographic and (not target_epsg or target_epsg in ("4326","4269","4258","4230")):
                        bounds = ds.bounds
                        lon = (bounds.left + bounds.right) / 2
                        lat = (bounds.bottom + bounds.top) / 2
                        zone = int((lon + 180) / 6) + 1
                        target_epsg = str(32600 + zone if lat >= 0 else 32700 + zone)
                        update_job(job.job_id, "running", f"Geographic CRS detected — auto-selecting UTM EPSG:{target_epsg}...")

            epsg_label = f"EPSG:{target_epsg}" if target_epsg else "current CRS"
            update_job(job.job_id, "running", f"Resampling to {epsg_label}...")

            # Single real resample straight to EPSG:3857 (map-render CRS),
            # with the requested ground resolution corrected for Web
            # Mercator's cos(lat) scale distortion — replaces the previous
            # two full-resolution warps (target_epsg, then 3857) with one.
            extra_warp_args = None
            if job.target_resolution_m:
                res_3857 = job.target_resolution_m / math.cos(math.radians(center_lat))
                extra_warp_args = ["-tr", str(res_3857), str(res_3857)]

            # Metadata (epsg/pixel size/area) in the user's requested CRS —
            # computed via a VRT, no pixel data materialized.
            meta_warped = _warp_metadata(src_path, target_epsg, job.target_resolution_m)

            if is_cancelled(job.job_id): return

            update_job(job.job_id, "running", "Converting to COG (EPSG:3857)...")
            cog_gcs_dest = f"users/{job.clerk_id}/cogs/{job.image_id}.tif"
            convert_to_cog(src_path, cog_path, extra_warp_args=extra_warp_args)
            upload_to_gcs(cog_path, cog_gcs_dest)

            # Lightweight display COG for map viewing — non-fatal if skipped
            display_path = os.path.join(tmpdir, "display.tif")
            has_display = generate_display_cog(cog_path, display_path)
            if has_display:
                upload_to_gcs(display_path, f"users/{job.clerk_id}/cogs_display/{job.image_id}.tif")

            meta_cog = extract_metadata(cog_path)
            bbox = meta_cog.get("bbox", {})
            update_image(
                job.image_id,
                status="ready",
                epsg=meta_warped["epsg"],
                num_bands=meta_cog["num_bands"],
                pixel_size_x=meta_warped["pixel_size_x"],
                pixel_size_y=meta_warped["pixel_size_y"],
                area_ha=meta_warped["area_ha"],
                geoserver_layer=None,
                bbox_minx=bbox.get("minx"),
                bbox_miny=bbox.get("miny"),
                bbox_maxx=bbox.get("maxx"),
                bbox_maxy=bbox.get("maxy"),
                has_display_cog=has_display,
            )

            msg = f"Transform complete → EPSG:{job.target_epsg}" + \
                  (f" @ {job.target_resolution_m}m" if job.target_resolution_m else "")
            update_job(job.job_id, "done", msg)
            publish_status(job.job_id, "done", msg)

    except Exception as e:
        logging.error("Transform failed for job %s: %s", job.job_id, str(e))
        update_job(job.job_id, "failed", str(e))
        publish_status(job.job_id, "failed", str(e))
        update_image(job.image_id, status="failed")


@app.post("/transform")
async def transform_raster(job: TransformJob):
    """Runs synchronously within the request — Cloud Run's 3600s timeout on this
    service comfortably covers a warp+COG pass. BackgroundTasks looked async but
    Cloud Run can scale the instance to zero the moment the HTTP response is
    sent (it only sees an idle instance, not a task still running inside it),
    silently killing the job mid-transform and leaving it stuck in "running"
    forever. Cloud Tasks' dispatch_deadline (enqueue_raster_transform) is set
    to cover this same window so it doesn't consider the call itself timed out."""
    await run_in_threadpool(_do_transform, job)
    return {"status": "done"}


# ── Gap detection ─────────────────────────────────────────────────────────────

def _geojson_to_shp(geojson_path: str, tmpdir: str, target_epsg: int) -> str:
    """Convert GeoJSON to shapefile reprojected to target_epsg."""
    import json, fiona, fiona.crs
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from fiona.crs import from_epsg as fiona_epsg
    from pyproj import Transformer

    with open(geojson_path) as f:
        gj = json.load(f)
    if gj.get("type") == "FeatureCollection":
        feats = gj["features"]
    elif gj.get("type") == "Feature":
        feats = [gj]
    else:
        feats = [{"type": "Feature", "geometry": gj, "properties": {}}]

    geoms = [shape(f["geometry"]) for f in feats if f.get("geometry")]
    merged = unary_union(geoms)

    # Reproject from 4326 to target_epsg if needed
    if target_epsg and target_epsg != 4326:
        transformer = Transformer.from_crs(4326, target_epsg, always_xy=True)
        from shapely.ops import transform as shp_transform
        merged = shp_transform(transformer.transform, merged)

    out_shp = os.path.join(tmpdir, "aoi_reproj.shp")
    crs = fiona_epsg(target_epsg or 4326)
    schema = {"geometry": merged.geom_type, "properties": {}}
    with fiona.open(out_shp, "w", driver="ESRI Shapefile", crs=crs, schema=schema) as dst:
        dst.write({"geometry": mapping(merged), "properties": {}})
    return out_shp


def _download_vector_to_shp(gcs_path: str, tmpdir: str, job_id: str, target_epsg: int) -> str:
    """Download vector from GCS and return path to shapefile in target_epsg."""
    import zipfile, fiona
    from pyproj import Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union, transform as shp_transform
    from fiona.crs import from_epsg as fiona_epsg
    from pathlib import Path

    if gcs_path.lower().endswith('.geojson') or gcs_path.lower().endswith('.json'):
        local = os.path.join(tmpdir, "vec.geojson")
        download_from_gcs(gcs_path, local)
        return _geojson_to_shp(local, tmpdir, target_epsg)

    local_zip = os.path.join(tmpdir, "vec.zip")
    download_from_gcs(gcs_path, local_zip)
    extract_dir = os.path.join(tmpdir, "vec_extracted")
    os.makedirs(extract_dir, exist_ok=True)
    with zipfile.ZipFile(local_zip) as zf:
        zf.extractall(extract_dir)
    shp_files = list(Path(extract_dir).glob("**/*.shp"))
    if not shp_files:
        raise ValueError(f"No .shp in {gcs_path}")
    shp = str(shp_files[0])

    # Reproject if needed
    with fiona.open(shp) as src:
        src_epsg = src.crs.get("init", "").replace("epsg:", "") if src.crs else None
        src_epsg = int(src_epsg) if src_epsg else 4326
    if src_epsg == target_epsg:
        return shp

    with fiona.open(shp) as src:
        geoms = [shape(f["geometry"]) for f in src if f.get("geometry")]
    merged = unary_union(geoms)
    transformer = Transformer.from_crs(src_epsg, target_epsg, always_xy=True)
    merged = shp_transform(transformer.transform, merged)
    out_shp = os.path.join(tmpdir, "vec_reproj.shp")
    crs = fiona_epsg(target_epsg)
    schema = {"geometry": merged.geom_type, "properties": {}}
    with fiona.open(out_shp, "w", driver="ESRI Shapefile", crs=crs, schema=schema) as dst:
        dst.write({"geometry": mapping(merged), "properties": {}})
    return out_shp


class GapDetectionJob(BaseModel):
    job_id: str
    image_id: str
    params: dict = {}
    clerk_id: str = ""


def _do_analyze_gaps(job: GapDetectionJob):
    update_job(job.job_id, "running", "Starting gap detection...")
    publish_status(job.job_id, "running", "Starting gap detection...")

    cog_gcs_path = f"users/{job.clerk_id}/cogs/{job.image_id}.tif"
    file_size    = get_gcs_file_size(cog_gcs_path)
    use_vsigs    = file_size > LARGE_FILE_THRESHOLD_BYTES
    size_mb      = file_size / 1024 / 1024

    with tempfile.TemporaryDirectory() as tmpdir:
        prob_cog_path = os.path.join(tmpdir, "gaps_prob.tif")
        geojson_path  = os.path.join(tmpdir, "gaps.geojson")

        try:
            if use_vsigs:
                update_job(job.job_id, "running", f"Large file ({size_mb:.0f} MB) — streaming from GCS...")
                src_path = vsigs_path(cog_gcs_path)
            else:
                update_job(job.job_id, "running", f"Downloading ({size_mb:.0f} MB)...")
                src_path = os.path.join(tmpdir, "source.tif")
                download_from_gcs(cog_gcs_path, src_path)

            # ── AOI clip ──────────────────────────────────────────────────────
            params = job.params or {}
            aoi_geojson = params.get("aoi_geojson")
            vector_id   = params.get("vector_id")

            if aoi_geojson or vector_id:
                import json as _json
                from rasterio.crs import CRS as _CRS
                import rasterio as _rio
                import fiona as _fiona
                from osgeo import gdal as _gdal

                # Get raster CRS
                with _rio.open(src_path if not src_path.startswith("/vsigs/") else f"/vsigs/{GCS_BUCKET}/{cog_gcs_path}") as _src:
                    raster_epsg = _src.crs.to_epsg() if _src.crs else 3857

                # Build AOI shapefile
                aoi_shp_path = os.path.join(tmpdir, "aoi.shp")
                if aoi_geojson:
                    update_job(job.job_id, "running", "Applying AOI clip (GeoJSON)...")
                    gj_path = os.path.join(tmpdir, "aoi.geojson")
                    gj_data = aoi_geojson if isinstance(aoi_geojson, dict) else _json.loads(aoi_geojson)
                    with open(gj_path, "w") as _f:
                        _json.dump(gj_data, _f)
                    aoi_shp_path = _geojson_to_shp(gj_path, tmpdir, raster_epsg)
                elif vector_id:
                    update_job(job.job_id, "running", "Applying AOI clip (vector)...")
                    conn = get_conn(); cur = conn.cursor()
                    cur.execute("SELECT gcs_path FROM vectors WHERE id = %s", (vector_id,))
                    vec = cur.fetchone(); cur.close(); conn.close()
                    if vec:
                        aoi_shp_path = _download_vector_to_shp(vec["gcs_path"], tmpdir, job.job_id, raster_epsg)

                # Clip raster to AOI bounds
                import fiona as _fiona2
                with _fiona2.open(aoi_shp_path) as _v:
                    minx, miny, maxx, maxy = _v.bounds
                clipped_path = os.path.join(tmpdir, "clipped.tif")
                _gdal.Warp(clipped_path, src_path if not src_path.startswith("/vsigs/") else f"/vsigs/{GCS_BUCKET}/{cog_gcs_path}",
                    format="GTiff", outputBounds=[minx, miny, maxx, maxy],
                    creationOptions=["COMPRESS=LZW", "TILED=YES", "BIGTIFF=YES"])
                src_path = clipped_path

            from gaps_analyzer import detect_gaps

            def _update(msg):
                update_job(job.job_id, "running", msg)
                publish_status(job.job_id, "running", msg)

            stats = detect_gaps(
                src_path=src_path,
                prob_cog_path=prob_cog_path,
                geojson_path=geojson_path,
                job_id=job.job_id,
                update_job_fn=_update,
            )

            # Upload outputs to GCS
            update_job(job.job_id, "running", "Uploading results...")
            upload_to_gcs(prob_cog_path, f"jobs/{job.job_id}/gaps_probability.tif")
            upload_to_gcs(geojson_path,  f"jobs/{job.job_id}/gaps.geojson")

            # Register outputs in DB
            conn = get_conn()
            cur  = conn.cursor()
            cur.execute("""
                INSERT INTO job_outputs (job_id, output_type, label, gcs_path, file_size_bytes, is_visualizable, layer_type)
                VALUES
                  (%s, 'raster_cog', 'Gap probability', %s, %s, true,  'raster'),
                  (%s, 'geojson',    'Gap polygons',    %s, %s, true,  'vector')
            """, (
                job.job_id, f"jobs/{job.job_id}/gaps_probability.tif", os.path.getsize(prob_cog_path),
                job.job_id, f"jobs/{job.job_id}/gaps.geojson",         os.path.getsize(geojson_path),
            ))
            conn.commit()
            cur.close()
            conn.close()

            summary_msg = (
                f"Gap detection complete — {stats['gap_count']} gaps detected, "
                f"{stats['gap_pct']}% of area ({stats['gap_area_ha']} ha)"
            )
            # Save summary with bbox for map zoom
            try:
                img_meta = extract_metadata(src_path)
                bbox = img_meta.get("bbox", {})
                update_job_summary(job.job_id, {
                    **stats,
                    "bbox": [bbox.get("minx"), bbox.get("miny"), bbox.get("maxx"), bbox.get("maxy")]
                    if bbox else None
                })
            except Exception:
                pass
            update_job(job.job_id, "done", summary_msg)
            publish_status(job.job_id, "done", summary_msg)

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            logging.error("Gap detection failed for job %s: %s", job.job_id, str(e))


@app.post("/analyze/gaps")
async def analyze_gaps(job: GapDetectionJob, background_tasks: BackgroundTasks):
    """Accept immediately — Cloud Tasks gets 200 right away, no 30-min timeout."""
    update_job(job.job_id, "running", "Accepted — processing in background...")
    publish_status(job.job_id, "running", "Accepted — processing in background...")
    background_tasks.add_task(_do_analyze_gaps, job)
    return {"status": "accepted"}
