import os
import logging
import zipfile
from pathlib import Path
import numpy as np
import rasterio
import rasterio.warp
from rasterio.crs import CRS
from pyproj import Transformer
from osgeo import gdal, osr, ogr
import fiona
import fiona.transform
from google.cloud import storage

log = logging.getLogger(__name__)

GCS_BUCKET = os.getenv("GCS_BUCKET", "timbermap-data")
gdal.UseExceptions()


def download_from_gcs(gcs_path: str, local_path: str):
    client = storage.Client()
    client.bucket(GCS_BUCKET).blob(gcs_path).download_to_filename(local_path)
    log.info("Downloaded gs://%s/%s → %s", GCS_BUCKET, gcs_path, local_path)


def upload_to_gcs(local_path: str, gcs_path: str) -> int:
    client = storage.Client()
    blob = client.bucket(GCS_BUCKET).blob(gcs_path)
    blob.upload_from_filename(local_path)
    size = Path(local_path).stat().st_size
    log.info("Uploaded %s → gs://%s/%s (%d bytes)", local_path, GCS_BUCKET, gcs_path, size)
    return size


def get_raster_epsg(raster_path: str) -> int:
    """Returns the EPSG code of a raster."""
    with rasterio.open(raster_path) as src:
        epsg = src.crs.to_epsg() if src.crs else None
    return epsg or 4326


def reproject_vector_to_epsg(input_shp: str, target_epsg: int, job_id: str) -> str:
    """
    Reprojects a shapefile to the target EPSG.
    Returns path to reprojected shapefile in /tmp/.
    """
    out_path = f"/tmp/{job_id}_vector_reproj.shp"
    target_crs = CRS.from_epsg(target_epsg)

    with fiona.open(input_shp) as src:
        src_crs  = src.crs
        src_epsg = CRS.from_user_input(src_crs).to_epsg() if src_crs else None

        if src_epsg == target_epsg:
            log.info("Vector already in EPSG:%d, no reprojection needed", target_epsg)
            return input_shp

        log.info("Reprojecting vector from EPSG:%d → EPSG:%d", src_epsg, target_epsg)

        out_meta = src.meta.copy()
        out_meta['crs'] = target_crs.to_wkt()

        with fiona.open(out_path, 'w', **out_meta) as dst:
            for feature in src:
                geom = fiona.transform.transform_geom(
                    src_crs, target_crs.to_wkt(), feature['geometry']
                )
                dst.write({**feature, 'geometry': geom})

    log.info("Reprojected vector → %s", out_path)
    return out_path


def clip_raster_to_vector(input_tiff: str, vector_path: str, job_id: str) -> str:
    """
    Clips a raster to the bounding box of a vector.
    Automatically reprojects the vector to match the raster CRS.
    """
    out_path = f"/tmp/{job_id}_clipped.tif"

    # Get raster EPSG
    raster_epsg = get_raster_epsg(input_tiff)

    # Reproject vector to raster EPSG if needed
    aligned_vector = reproject_vector_to_epsg(vector_path, raster_epsg, job_id)

    with fiona.open(aligned_vector) as src:
        minx, miny, maxx, maxy = src.bounds

    result = gdal.Warp(
        out_path, input_tiff,
        format="GTiff",
        outputBounds=[minx, miny, maxx, maxy],
        creationOptions=["BLOCKXSIZE=512", "BLOCKYSIZE=512", "BIGTIFF=YES",
                         "TILED=YES", "COMPRESS=LZW"],
    )
    result = None
    log.info("Clipped → %s  (EPSG:%d)", out_path, raster_epsg)
    return out_path


def get_pixel_size_cm(raster_path: str) -> float:
    """Real-world ground sample distance in cm/pixel — geodesically
    accurate even for rasters in a geographic (degrees) CRS, where the raw
    pixel_size in degrees isn't directly comparable to a cm target."""
    with rasterio.open(raster_path) as src:
        transform = src.transform
        crs = src.crs
        x0, y0 = transform * (0, 0)
        x1, y1 = transform * (1, 0)
    if crs.is_geographic:
        from pyproj import Geod
        geod = Geod(ellps="WGS84")
        _, _, dist_m = geod.inv(x0, y0, x1, y1)
    else:
        dist_m = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    return dist_m * 100


def resample_to_gsd_if_needed(input_tiff: str, target_gsd_cm: float, job_id: str,
                               tolerance: float = 0.05) -> tuple[str, dict]:
    """Resamples to target_gsd_cm/pixel if the raster's actual GSD differs
    by more than `tolerance` (default 5%) — models are trained at a
    specific resolution and degrade on mismatched input. Returns
    (path_to_use, info) where info is safe to store on the job for
    auditability, e.g. {"resampled": true, "from_gsd_cm": 8.2, "to_gsd_cm": 10}."""
    actual_cm = get_pixel_size_cm(input_tiff)
    info = {"resampled": False, "from_gsd_cm": round(actual_cm, 3), "to_gsd_cm": target_gsd_cm}
    if actual_cm <= 0 or abs(actual_cm - target_gsd_cm) / target_gsd_cm <= tolerance:
        return input_tiff, info

    out_path = f"/tmp/{job_id}_resampled.tif"
    target_m = target_gsd_cm / 100
    with rasterio.open(input_tiff) as src:
        crs = src.crs
    warp_kwargs = dict(
        xRes=target_m, yRes=target_m, resampleAlg="bilinear",
        creationOptions=["BIGTIFF=YES", "TILED=YES", "COMPRESS=LZW"],
    )
    if crs.is_geographic:
        # xRes/yRes are in the *destination* CRS's units — a geographic
        # source has no meaningful "meters" resolution, so reproject to a
        # metric CRS (Web Mercator) as part of the same warp.
        warp_kwargs["dstSRS"] = "EPSG:3857"
    result = gdal.Warp(out_path, input_tiff, **warp_kwargs)
    result = None
    info["resampled"] = True
    log.info("Resampled %s: %.2fcm/px → %.2fcm/px (%s)", input_tiff, actual_cm, target_gsd_cm, out_path)
    return out_path, info


def convert_to_cog(input_tiff: str, job_id: str, suffix: str = "cog") -> str:
    """Converts a GeoTIFF to COG using GDAL."""
    out_path = f"/tmp/{job_id}_{suffix}.tif"
    result = gdal.Warp(
        out_path, input_tiff,
        format="COG",
        creationOptions=["BLOCKSIZE=256", "COMPRESS=DEFLATE",
                         "TILING_SCHEME=GoogleMapsCompatible", "BIGTIFF=YES"],
    )
    result = None
    log.info("COG → %s", out_path)
    return out_path


def extract_vector_to_shp(vector_gcs_path: str, job_id: str) -> str:
    """Downloads a vector from GCS and returns path to a .shp file.
    Handles both zip shapefiles and GeoJSON files."""
    # GeoJSON case
    if vector_gcs_path.lower().endswith('.geojson') or vector_gcs_path.lower().endswith('.json'):
        local_geojson = f"/tmp/{job_id}_vector.geojson"
        download_from_gcs(vector_gcs_path, local_geojson)
        return geojson_to_shp(local_geojson, job_id)
    # Zip shapefile case
    local_zip = f"/tmp/{job_id}_vector.zip"
    download_from_gcs(vector_gcs_path, local_zip)
    extract_dir = f"/tmp/{job_id}_vector_extracted"
    os.makedirs(extract_dir, exist_ok=True)
    with zipfile.ZipFile(local_zip, "r") as zf:
        zf.extractall(extract_dir)
    shp_files = list(Path(extract_dir).glob("**/*.shp"))
    if not shp_files:
        raise ValueError(f"No .shp file found in {vector_gcs_path}")
    return str(shp_files[0])


def zip_shapefile(shp_path: str, output_zip: str) -> str:
    """Zips all files belonging to a shapefile."""
    base = Path(shp_path).stem
    folder = Path(shp_path).parent
    extensions = [".shp", ".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx"]
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for ext in extensions:
            f = folder / (base + ext)
            if f.exists():
                zf.write(f, f.name)
    log.info("Zipped shapefile → %s", output_zip)
    return output_zip


def get_bbox_4326(src_path: str) -> list[float]:
    """Returns [minx, miny, maxx, maxy] in EPSG:4326 using rasterio."""
    with rasterio.open(src_path) as src:
        bounds  = src.bounds
        src_crs = src.crs

    if src_crs and src_crs.to_epsg() == 4326:
        return [bounds.left, bounds.bottom, bounds.right, bounds.top]

    dst_crs = CRS.from_epsg(4326)
    left, bottom, right, top = rasterio.warp.transform_bounds(
        src_crs, dst_crs, bounds.left, bounds.bottom, bounds.right, bounds.top
    )
    return [left, bottom, right, top]
"""
PATCH para geo_utils.py — agregar esta función junto a extract_vector_to_shp
"""

def points_to_density_cog(features: list, ref_raster: str, job_id: str,
                          resolution: float | None = None,
                          cell_size_m: float = 15.0) -> str:
    """
    Rasterizes point features into a density COG.
    Each pixel value = number of points falling in that cell.

    Cell size defaults to cell_size_m (real-world meters, converted to the
    raster's own CRS units under the hood) rather than the source raster's
    native pixel size — at native resolution (often <10cm) almost every
    cell holds 0 or 1 point, which renders as near-binary noise instead of
    a readable density surface. ~15m cells give each cell a meaningful
    count while still resolving individual clusters at a useful zoom.
    Pass `resolution` directly (in the raster's own CRS units) to override.
    """
    import subprocess
    import tempfile

    if not features:
        raise ValueError("No features to rasterize")

    # Write points as GeoJSON
    tmp_geojson = f"/tmp/{job_id}_density_pts.geojson"
    import json as _json
    fc = {"type": "FeatureCollection", "features": features}
    with open(tmp_geojson, "w") as f:
        _json.dump(fc, f)

    # Get ref raster info
    with rasterio.open(ref_raster) as src:
        left   = src.bounds.left
        bottom = src.bounds.bottom
        right  = src.bounds.right
        top    = src.bounds.top
        epsg   = src.crs.to_epsg() if src.crs else 4326

        if resolution is not None:
            res = resolution
        elif src.crs and src.crs.is_geographic:
            # Convert the desired meter cell size to degrees at this
            # raster's latitude (same approximation used elsewhere for
            # geographic-CRS pixel-area math).
            import math
            center_lat = bottom + (top - bottom) / 2
            meter_per_deg_lat = 111320.0
            meter_per_deg_lon = 111320.0 * math.cos(math.radians(center_lat))
            res = cell_size_m / max(meter_per_deg_lat, meter_per_deg_lon)
        else:
            res = cell_size_m

    raw_tif = f"/tmp/{job_id}_density_raw.tif"
    cog_tif = f"/tmp/{job_id}_density_cog.tif"

    # Rasterize: count points per pixel
    cmd = [
        "gdal_rasterize",
        "-burn", "1",
        "-add",                         # accumulate (count) per pixel
        "-tr", str(res), str(res),
        "-te", str(left), str(bottom), str(right), str(top),
        "-a_srs", f"EPSG:{epsg}",
        "-ot", "Float32",
        "-of", "GTiff",
        "-co", "COMPRESS=DEFLATE",
        "-co", "TILED=YES",
        "-co", "BLOCKXSIZE=512",
        "-co", "BLOCKYSIZE=512",
        tmp_geojson, raw_tif,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gdal_rasterize failed: {r.stderr[:400]}")

    # Warp → COG (GoogleMapsCompatible tiling for web display)
    result = gdal.Warp(
        cog_tif, raw_tif,
        format="COG",
        creationOptions=[
            "BLOCKSIZE=256", "COMPRESS=DEFLATE",
            "TILING_SCHEME=GoogleMapsCompatible", "BIGTIFF=YES",
        ],
    )
    result = None

    # Cleanup temp files
    import os as _os
    for p in [tmp_geojson, raw_tif]:
        try:
            _os.remove(p)
        except OSError:
            pass

    log.info("Density COG → %s  (res=%.4f, epsg=%d, %d points)", cog_tif, res, epsg, len(features))
    return cog_tif


def geojson_to_shp(geojson_path: str, job_id: str) -> str:
    """
    Converts a GeoJSON file to a shapefile (.shp) for use as AOI clip.
    Reprojects to EPSG:4326 if needed, then returns path to .shp.
    """
    import os
    import fiona
    import fiona.crs
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    import json

    out_dir = f"/tmp/{job_id}_aoi_shp"
    os.makedirs(out_dir, exist_ok=True)
    out_shp = os.path.join(out_dir, "aoi.shp")

    with open(geojson_path) as f:
        gj = json.load(f)

    # Handle FeatureCollection, Feature, or raw geometry
    if gj.get("type") == "FeatureCollection":
        features = gj["features"]
    elif gj.get("type") == "Feature":
        features = [gj]
    else:
        # Raw geometry
        features = [{"type": "Feature", "geometry": gj, "properties": {}}]

    if not features:
        raise ValueError("GeoJSON has no features")

    # Merge all geometries into a single polygon (union)
    geoms = [shape(f["geometry"]) for f in features if f.get("geometry")]
    merged = unary_union(geoms)

    crs = fiona.crs.from_epsg(4326)
    schema = {"geometry": merged.geom_type, "properties": {}}

    with fiona.open(out_shp, "w", driver="ESRI Shapefile", crs=crs, schema=schema) as dst:
        dst.write({"geometry": mapping(merged), "properties": {}})

    return out_shp
