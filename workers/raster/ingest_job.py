"""
workers/raster/ingest_job.py
Cloud Run Job entrypoint for raster ingest.
Reads config from env vars set by the API when executing the job.
Runs to completion — no HTTP timeout, up to 24h.
"""

import os
import json
import logging
import tempfile
import numpy as np
from dotenv import load_dotenv
from google.cloud import storage, pubsub_v1
import psycopg2
import psycopg2.extras

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

GCS_BUCKET  = os.getenv("GCS_BUCKET", "timbermap-data")
GCP_PROJECT = os.getenv("GCP_PROJECT", "timbermap-prod")

# Job parameters — injected as env vars by the API
JOB_ID   = os.environ["INGEST_JOB_ID"]
IMAGE_ID = os.environ["INGEST_IMAGE_ID"]
GCS_PATH = os.environ["INGEST_GCS_PATH"]
FILENAME = os.environ["INGEST_FILENAME"]
CLERK_ID = os.environ.get("INGEST_CLERK_ID", "")

# Configure GDAL for GCS access
from osgeo import gdal as _gdal
_gdal.UseExceptions()
_gdal.SetConfigOption("CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE", "YES")
_gdal.SetConfigOption("GDAL_HTTP_TIMEOUT", "300")
_gdal.SetConfigOption("CPL_GCE_CREDENTIALS_URL",
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token")


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


def update_job(status: str, message: str):
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
        (status, message, status, JOB_ID),
    )
    conn.commit()
    cur.close()
    conn.close()
    logging.info("[%s] %s — %s", JOB_ID[:8], status, message)


def update_image(**kwargs):
    if not kwargs:
        return
    fields = ", ".join(f"{k} = %s" for k in kwargs)
    values = list(kwargs.values()) + [IMAGE_ID]
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"UPDATE images SET {fields} WHERE id = %s", values)
    conn.commit()
    cur.close()
    conn.close()


def publish_status(status: str, message: str):
    try:
        publisher = pubsub_v1.PublisherClient()
        topic = f"projects/{GCP_PROJECT}/topics/job-status"
        publisher.publish(
            topic,
            json.dumps({"job_id": JOB_ID, "status": status, "message": message}).encode(),
        )
    except Exception:
        pass


# ── GCS helpers ───────────────────────────────────────────────────────────────

def get_gcs_file_size() -> int:
    blob = storage.Client().bucket(GCS_BUCKET).blob(GCS_PATH)
    blob.reload()
    return blob.size or 0


def download_from_gcs(local_path: str):
    blob = storage.Client().bucket(GCS_BUCKET).blob(GCS_PATH)
    blob.chunk_size = 32 * 1024 * 1024  # 32MB chunks
    blob.download_to_filename(local_path)


def upload_to_gcs(local_path: str, gcs_dest: str):
    storage.Client().bucket(GCS_BUCKET).blob(gcs_dest).upload_from_filename(local_path)


# ── Raster processing ─────────────────────────────────────────────────────────

def extract_metadata(tif_path: str) -> dict:
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


def generate_thumbnail(tif_path: str, thumb_path: str, size: int = 256):
    import rasterio
    from rasterio.enums import Resampling
    from PIL import Image
    with rasterio.open(tif_path) as src:
        scale = min(size / src.width, size / src.height)
        new_w = max(1, int(src.width * scale))
        new_h = max(1, int(src.height * scale))
        if src.count >= 3:
            data = src.read([1, 2, 3], out_shape=(3, new_h, new_w), resampling=Resampling.nearest)
            img_array = np.moveaxis(data, 0, -1)
        else:
            data = src.read(1, out_shape=(1, new_h, new_w), resampling=Resampling.nearest)
            img_array = np.stack([data[0], data[0], data[0]], axis=-1)
        img_array = img_array.astype(np.float32)
        mn, mx = float(img_array.min()), float(img_array.max())
        if mx > mn:
            img_array = (img_array - mn) / (mx - mn) * 255
        Image.fromarray(img_array.astype(np.uint8), "RGB").save(thumb_path, "JPEG", quality=85)


def convert_to_cog(input_path: str, output_path: str):
    import subprocess
    from osgeo import gdal
    gdal.UseExceptions()

    gdal_env = os.environ.copy()
    gdal_env.update({
        "CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE": "YES",
        "GDAL_HTTP_TIMEOUT": "300",
        "CPL_GCE_CREDENTIALS_URL": (
            "http://metadata.google.internal/computeMetadata/v1/"
            "instance/service-accounts/default/token"
        ),
    })

    # Detect data bands — exclude alpha
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
        data_bands = [1]

    band_args = []
    for b in data_bands:
        band_args += ["-b", str(b)]

    import shutil

    def log_disk():
        total, used, free = shutil.disk_usage("/tmp")
        logging.info("Disk /tmp: %.1fGB used, %.1fGB free", used/1e9, free/1e9)

    # Check uncompressed size before processing — fail fast if too large for /tmp
    ds_check = gdal.Open(input_path)
    if ds_check:
        w, h = ds_check.RasterXSize, ds_check.RasterYSize
        nbands_check = len(data_bands)
        dtype_size = gdal.GetDataTypeSize(ds_check.GetRasterBand(1).DataType) // 8
        uncompressed_gb = w * h * nbands_check * dtype_size / 1e9
        ds_check = None
        logging.info("Uncompressed size estimate: %.1fGB (%dx%d, %d bands)", uncompressed_gb, w, h, nbands_check)
        # Intermediates use DEFLATE compression (~3:1 ratio on imagery).
        # Peak disk: warped_compressed + overviews + COG ≈ 1.5× uncompressed
        estimated_disk_gb = uncompressed_gb * 1.5
        if estimated_disk_gb > 28:  # 28GB limit (leave 4GB buffer in 32GB /tmp)
            raise RuntimeError(
                f"Image too large to process: estimated {estimated_disk_gb:.0f}GB disk needed "
                f"({uncompressed_gb:.1f}GB uncompressed, {w}×{h}px, {nbands_check} bands). "
                f"Maximum supported: ~18GB uncompressed. "
                f"Please reduce resolution or area before uploading."
            )

    warped_path = output_path + "_3857.tif"

    # Step 1: reproject to EPSG:3857
    log_disk()
    logging.info("Step 1/3: gdalwarp → EPSG:3857")
    cmd_warp = [
        "gdalwarp", "-t_srs", "EPSG:3857", "-r", "bilinear",
        "-of", "GTiff",
        "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=2",
        "-co", "TILED=YES", "-co", "BLOCKXSIZE=512", "-co", "BLOCKYSIZE=512",
        "-co", "BIGTIFF=YES",
        "-wm", "4000", "-multi",
        "--config", "GDAL_CACHEMAX", "2048",
        "--config", "GDAL_NUM_THREADS", "ALL_CPUS",
    ] + band_args + [input_path, warped_path]
    r1 = subprocess.run(cmd_warp, capture_output=True, text=True, timeout=86400, env=gdal_env)
    if r1.returncode != 0:
        raise RuntimeError(f"gdalwarp failed: {r1.stderr[:500]}")

    # Delete source to free disk
    if os.path.exists(input_path) and input_path != warped_path:
        os.remove(input_path)

    # Step 2: build overviews
    log_disk()
    logging.info("Step 2/3: gdaladdo overviews")
    cmd_addo = [
        "gdaladdo",
        "--config", "GDAL_CACHEMAX", "2048",
        "--config", "COMPRESS_OVERVIEW", "DEFLATE",
        "--config", "GDAL_NUM_THREADS", "ALL_CPUS",
        "-r", "nearest", warped_path,
        "2", "4", "8", "16", "32", "64", "128",
    ]
    r2 = subprocess.run(cmd_addo, capture_output=True, text=True, timeout=86400, env=gdal_env)
    if r2.returncode != 0:
        if os.path.exists(warped_path):
            os.remove(warped_path)
        raise RuntimeError(f"gdaladdo failed: {r2.stderr[:500]}")

    # Step 3: translate to COG
    log_disk()
    logging.info("Step 3/3: gdal_translate → COG")
    cmd_cog = [
        "gdal_translate", "-of", "COG",
        "-co", "BLOCKSIZE=256",
        "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=2",
        "-co", "OVERVIEWS=FORCE_USE_EXISTING", "-co", "BIGTIFF=YES",
        "--config", "GDAL_CACHEMAX", "2048",
        "--config", "GDAL_NUM_THREADS", "ALL_CPUS",
        warped_path, output_path,
    ]
    r3 = subprocess.run(cmd_cog, capture_output=True, text=True, timeout=86400, env=gdal_env)
    if os.path.exists(warped_path):
        os.remove(warped_path)
    if r3.returncode != 0:
        raise RuntimeError(f"gdal_translate COG failed (rc={r3.returncode}): stdout={r3.stdout[:300]} stderr={r3.stderr[:300]}")


def generate_display_cog(cog_path: str, display_path: str) -> bool:
    """Lightweight JPEG-compressed COG for map display.

    8-bit imagery: re-encodes the first 3 bands as JPEG, letting the COG
    driver build a fresh overview pyramid — the common case for ordinary
    RGB(A) photos. (Previously reused the source COG's overviews via
    OVERVIEWS=FORCE_USE_EXISTING, but that silently produced zero
    overviews when the source had an alpha band, leaving huge images
    with no fast low-zoom path to render from — see San Ramon incident.)

    Non-8-bit imagery (e.g. UInt16 multispectral sensors — real values often
    occupy a small slice of the range, e.g. 0-5000 of 0-65535, so displaying
    them un-stretched renders as solid black): stretch each of the first 3
    bands to 0-255 using their actual min/max (nodata-aware, approximate —
    fast even on huge rasters) before JPEG-encoding. This is a real resample
    pass since the existing overviews were built for the original bit depth.
    """
    import subprocess
    from osgeo import gdal
    gdal.UseExceptions()

    ds = gdal.Open(cog_path)
    if ds is None:
        return False
    nbands = ds.RasterCount
    dtype  = ds.GetRasterBand(1).DataType
    is_byte = dtype == gdal.GDT_Byte
    if nbands not in (1, 2, 3, 4):
        ds = None
        return False

    gdal_env = os.environ.copy()
    gdal_env.update({
        "CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE": "YES",
        "GDAL_HTTP_TIMEOUT": "300",
    })

    if is_byte:
        display_bands = min(nbands, 3)
        band_args = []
        for i in range(1, display_bands + 1):
            band_args += ["-b", str(i)]
        ds = None
        cmd = [
            "gdal_translate", "-of", "COG",
            *band_args,
            "-co", "COMPRESS=JPEG", "-co", "QUALITY=82",
            "-co", "BLOCKSIZE=256",
            "-co", "BIGTIFF=YES",
            "--config", "GDAL_CACHEMAX", "2048",
            cog_path, display_path,
        ]
    else:
        display_bands = min(nbands, 3)
        band_args = []
        for i in range(1, display_bands + 1):
            band = ds.GetRasterBand(i)
            bmin, bmax, _mean, _std = band.GetStatistics(True, True)
            if bmax <= bmin:
                bmax = bmin + 1
            band_args += ["-b", str(i), f"-scale_{i}", str(bmin), str(bmax), "0", "255"]
        ds = None
        cmd = [
            "gdal_translate", "-of", "COG", "-ot", "Byte",
            *band_args,
            "-co", "COMPRESS=JPEG", "-co", "QUALITY=82",
            "-co", "BLOCKSIZE=256",
            "-co", "BIGTIFF=YES",
            "--config", "GDAL_CACHEMAX", "2048",
            cog_path, display_path,
        ]

    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=gdal_env)
    if r.returncode != 0:
        logging.warning("Display COG generation failed for %s: %s", cog_path, r.stderr[:300])
        return False
    return True


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    logging.info("Starting ingest job — job=%s image=%s file=%s", JOB_ID, IMAGE_ID, FILENAME)

    try:
        file_size = get_gcs_file_size()
    except Exception as e:
        msg = f"File not found in GCS: {GCS_PATH} — {e}"
        logging.error(msg)
        update_job("failed", msg)
        update_image(status="failed")
        raise SystemExit(1)

    size_mb = file_size / 1024 / 1024

    with tempfile.TemporaryDirectory() as tmpdir:
        safe_filename = os.path.basename(FILENAME)
        if not safe_filename or safe_filename in (".", ".."):
            safe_filename = "input"
        src_path   = os.path.join(tmpdir, safe_filename)
        cog_path   = os.path.join(tmpdir, "cog.tif")
        thumb_path = os.path.join(tmpdir, "thumb.jpg")

        try:
            update_job("running", f"Downloading ({size_mb:.0f} MB)...")
            publish_status("running", f"Downloading ({size_mb:.0f} MB)...")
            download_from_gcs(src_path)
            logging.info("Download complete (%.0f MB)", size_mb)

            update_job("running", "Reading metadata...")
            meta = extract_metadata(src_path)
            logging.info("Metadata: %s", meta)

            update_job("running", f"Converting to COG ({size_mb:.0f} MB)...")
            publish_status("running", f"Converting to COG ({size_mb:.0f} MB)...")
            cog_gcs_dest = f"users/{CLERK_ID}/cogs/{IMAGE_ID}.tif"
            convert_to_cog(src_path, cog_path)
            logging.info("COG conversion complete, uploading...")

            upload_to_gcs(cog_path, cog_gcs_dest)
            logging.info("COG uploaded to %s", cog_gcs_dest)

            update_job("running", "Generating thumbnail...")
            generate_thumbnail(cog_path, thumb_path)
            upload_to_gcs(thumb_path, f"users/{CLERK_ID}/thumbnails/{IMAGE_ID}.jpg")
            logging.info("Thumbnail uploaded")

            update_job("running", "Generating display COG...")
            display_path = os.path.join(tmpdir, "display.tif")
            has_display = generate_display_cog(cog_path, display_path)
            if has_display:
                upload_to_gcs(display_path, f"users/{CLERK_ID}/cogs_display/{IMAGE_ID}.tif")
                logging.info("Display COG uploaded")
            else:
                logging.info("Display COG skipped (unsupported band/dtype or translate failed)")

            bbox = meta.get("bbox", {})
            update_image(
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

            update_job("done", "Ingest complete")
            publish_status("done", "Ingest complete")
            logging.info("Ingest complete for job %s", JOB_ID)

        except Exception as e:
            msg = str(e)
            logging.error("Ingest failed for job %s: %s", JOB_ID, msg, exc_info=True)
            update_job("failed", msg)
            publish_status("failed", msg)
            update_image(status="failed")
            raise SystemExit(1)


if __name__ == "__main__":
    main()
