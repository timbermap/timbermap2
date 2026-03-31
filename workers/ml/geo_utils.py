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
