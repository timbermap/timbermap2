"""
workers/raster/main.py
Raster ingest + COG worker — memory-optimized via GDAL disk-based processing.
For large files (>1GB): reads directly from GCS via /vsigs/ without downloading.
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

GCS_BUCKET     = os.getenv("GCS_BUCKET", "timbermap-data")
GCP_PROJECT    = os.getenv("GCP_PROJECT", "timbermap-prod")

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
    storage.Client().bucket(GCS_BUCKET).blob(gcs_path).download_to_filename(local_path)


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
        creationOptions=["COMPRESS=LZW", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
    )
    result = gdal.Translate(output_path, input_path, options=opts)
    if result is None:
        raise RuntimeError(f"gdal.Translate strip alpha failed for {input_path}")
    result.FlushCache()
    result = None
    return output_path


def generate_thumbnail(tif_path: str, thumb_path: str, size: int = 256):
    """Generate thumbnail via heavily downsampled read — works with /vsigs/ paths."""
    import rasterio
    from rasterio.enums import Resampling
    from PIL import Image

    with rasterio.open(tif_path) as src:
        scale = min(size / src.width, size / src.height)
        new_w = max(1, int(src.width * scale))
        new_h = max(1, int(src.height * scale))

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

        img_min, img_max = float(img_array.min()), float(img_array.max())
        if img_max > img_min:
            img_array = ((img_array - img_min) / (img_max - img_min) * 255)
        img_array = img_array.astype(np.uint8)
        Image.fromarray(img_array, "RGB").save(thumb_path, "JPEG", quality=85)


def convert_to_cog(input_path: str, output_path: str, gcs_output_path: Optional[str] = None):
    """
    Convert to Cloud-Optimized GeoTIFF in EPSG:3857.
    input_path can be a local path OR a /vsigs/ path — GDAL handles both.

    For large files (input from /vsigs/), writes COG directly to GCS via /vsigs/
    to avoid filling up the 512MB /tmp on Cloud Run.
    gcs_output_path: GCS path like "users/cogs/{image_id}.tif" — used to build
    the /vsigs/ output path when input is large. If None, writes to output_path locally.
    """
    from osgeo import gdal
    gdal.UseExceptions()

    # Strip alpha only for local files
    if input_path.startswith("/vsigs/"):
        working_path = input_path
    else:
        stripped_path = input_path + "_rgb.tif"
        working_path = strip_alpha_gdal(input_path, stripped_path)

    # For large files coming via /vsigs/, write COG output directly back to GCS
    # to avoid /tmp overflow. COG driver supports /vsigs/ output.
    if input_path.startswith("/vsigs/") and gcs_output_path:
        actual_output = f"/vsigs/{GCS_BUCKET}/{gcs_output_path}"
        # Required for GDAL to write COG (random-write format) to /vsigs/
        gdal.SetConfigOption("CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE", "YES")
        gdal.SetConfigOption("CPL_VSIL_TEMP_FILE_DIR", "/tmp")
    else:
        actual_output = output_path

    warp_opts = gdal.WarpOptions(
        dstSRS="EPSG:3857",
        resampleAlg=gdal.GRA_Bilinear,
        format="COG",
        creationOptions=[
            "BLOCKSIZE=256",
            "TILING_SCHEME=GoogleMapsCompatible",
            "COMPRESS=DEFLATE",
            "OVERVIEWS=IGNORE_EXISTING",
            "NUM_THREADS=ALL_CPUS",
        ],
        dstAlpha=True,
        warpOptions=["INIT_DEST=255,255,255,0"],
        warpMemoryLimit=512,    # Low RAM usage — forces tile-based disk processing, safe for 20GB+
        multithread=True,
    )
    result = gdal.Warp(actual_output, working_path, options=warp_opts)
    if result is None:
        raise RuntimeError(f"gdal.Warp COG conversion failed for {working_path}")
    result.FlushCache()
    result = None

    if not input_path.startswith("/vsigs/") and working_path != input_path and os.path.exists(working_path):
        os.remove(working_path)

    # Return whether we wrote directly to GCS (caller skips upload in that case)
    return actual_output == f"/vsigs/{GCS_BUCKET}/{gcs_output_path}" if gcs_output_path else False


def warp_raster(input_path: str, output_path: str,
                target_epsg: str, target_resolution_m: Optional[float] = None):
    """Reproject raster — disk-based. input_path can be /vsigs/."""
    from osgeo import gdal
    gdal.UseExceptions()
    warp_opts = gdal.WarpOptions(
        dstSRS=f"EPSG:{target_epsg}",
        xRes=target_resolution_m,
        yRes=target_resolution_m,
        resampleAlg=gdal.GRA_Bilinear,
        creationOptions=["COMPRESS=LZW", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
        format="GTiff",
        warpMemoryLimit=512,    # Low RAM usage — safe for large files
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
    update_job(job.job_id, "running", "Checking file size...")
    publish_status(job.job_id, "running", "Checking file size...")

    # Check if file is large — if so, use /vsigs/ to avoid downloading
    file_size = get_gcs_file_size(job.gcs_path)
    use_vsigs = file_size > LARGE_FILE_THRESHOLD_BYTES
    size_mb = file_size / 1024 / 1024

    with tempfile.TemporaryDirectory() as tmpdir:
        thumb_path = os.path.join(tmpdir, "thumb.jpg")
        cog_path   = os.path.join(tmpdir, "cog.tif")

        try:
            if use_vsigs:
                # Large file: read directly from GCS — no download needed
                update_job(job.job_id, "running", f"Large file ({size_mb:.0f} MB) — streaming from GCS...")
                src_path = vsigs_path(job.gcs_path)
            else:
                # Small file: download to local temp for faster processing
                update_job(job.job_id, "running", f"Downloading ({size_mb:.0f} MB)...")
                src_path = os.path.join(tmpdir, job.filename)
                download_from_gcs(job.gcs_path, src_path)

            update_job(job.job_id, "running", "Reading metadata...")
            meta = extract_metadata(src_path)

            update_job(job.job_id, "running", "Generating thumbnail...")
            generate_thumbnail(src_path, thumb_path)
            upload_to_gcs(thumb_path, f"users/thumbnails/{job.image_id}.jpg")

            update_job(job.job_id, "running", f"Converting to COG ({size_mb:.0f} MB)...")
            cog_gcs_dest = f"users/cogs/{job.image_id}.tif"
            wrote_direct = convert_to_cog(src_path, cog_path, gcs_output_path=cog_gcs_dest if use_vsigs else None)
            if not wrote_direct:
                upload_to_gcs(cog_path, cog_gcs_dest)

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
    update_job(job.job_id, "running", "Checking file size...")
    publish_status(job.job_id, "running", "Starting raster transform...")

    cog_gcs_path = f"users/cogs/{job.image_id}.tif"
    file_size    = get_gcs_file_size(cog_gcs_path)
    use_vsigs    = file_size > LARGE_FILE_THRESHOLD_BYTES
    size_mb      = file_size / 1024 / 1024

    with tempfile.TemporaryDirectory() as tmpdir:
        warped_path = os.path.join(tmpdir, "warped.tif")
        cog_path    = os.path.join(tmpdir, "cog.tif")

        try:
            if use_vsigs:
                update_job(job.job_id, "running", f"Large file ({size_mb:.0f} MB) — streaming from GCS...")
                src_path = vsigs_path(cog_gcs_path)
            else:
                update_job(job.job_id, "running", f"Downloading ({size_mb:.0f} MB)...")
                src_path = os.path.join(tmpdir, "source.tif")
                download_from_gcs(cog_gcs_path, src_path)

            update_job(job.job_id, "running", f"Reprojecting to EPSG:{job.target_epsg}...")
            warp_raster(src_path, warped_path, job.target_epsg, job.target_resolution_m)

            meta_warped = extract_metadata(warped_path)

            update_job(job.job_id, "running", "Converting to COG (EPSG:3857)...")
            cog_gcs_dest = f"users/cogs/{job.image_id}.tif"
            # warped_path is always local so no direct-write needed here
            convert_to_cog(warped_path, cog_path)
            upload_to_gcs(cog_path, cog_gcs_dest)

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
            )

            msg = f"Transform complete → EPSG:{job.target_epsg}" + \
                  (f" @ {job.target_resolution_m}m" if job.target_resolution_m else "")
            update_job(job.job_id, "done", msg)
            publish_status(job.job_id, "done", msg)
            return {"status": "done", "meta": meta_warped}

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            update_image(job.image_id, status="failed")
            raise HTTPException(status_code=500, detail=str(e))


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


@app.post("/analyze/gaps")
async def analyze_gaps(job: GapDetectionJob):
    update_job(job.job_id, "running", "Starting gap detection...")
    publish_status(job.job_id, "running", "Starting gap detection...")

    cog_gcs_path = f"users/cogs/{job.image_id}.tif"
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
                    creationOptions=["COMPRESS=LZW", "TILED=YES"])
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
            return {"status": "done", "stats": stats}

        except Exception as e:
            update_job(job.job_id, "failed", str(e))
            publish_status(job.job_id, "failed", str(e))
            raise HTTPException(status_code=500, detail=str(e))
