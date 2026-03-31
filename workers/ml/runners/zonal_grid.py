import logging
import numpy as np
import json
from pathlib import Path
from osgeo import gdal, osr, ogr
from rasterstats import zonal_stats
import geopandas as gpd

import db
import geo_utils

log = logging.getLogger(__name__)


def run(job_id: str, prob_raster: str, cfg: dict, aoi_shp: str | None,
        epsg: int, geo_info: dict) -> tuple[list, dict]:
    """
    Phase 2 for zonal_grid pipeline (Detección de Fallas).
    1. Creates a vector grid of square cells over the image extent
    2. Optionally clips grid to AOI
    3. Runs rasterstats.zonal_stats to compute sum + mymean per cell
    4. Produces GeoJSON + shapefile of grid with attributes
    """
    log.info("Zonal grid — job=%s  config=%s", job_id, cfg)

    grid_cellsize  = float(cfg.get("grid_cellsize_m", 10))
    band_index     = int(cfg.get("band_index", 0))        # 0-based
    mymean_divisor = int(cfg.get("mymean_divisor", 25000))
    mymean_cap     = int(cfg.get("mymean_cap", 18))

    # ── Get image extent with rasterio (avoids _gdal_array) ─────────────────
    import rasterio as _rio
    with _rio.open(prob_raster) as _src:
        bounds = _src.bounds
        W, H   = _src.width, _src.height

    xmin = bounds.left
    xmax = bounds.right
    ymax = bounds.top
    ymin = bounds.bottom

    log.info("Extent: xmin=%.4f xmax=%.4f ymin=%.4f ymax=%.4f", xmin, xmax, ymin, ymax)

    # ── Create vector grid ────────────────────────────────────────────────────
    grid_path = f"/tmp/{job_id}_grid.shp"
    _create_grid(grid_path, xmin, xmax, ymin, ymax, grid_cellsize, epsg)
    log.info("Grid created: %s", grid_path)

    # ── Clip grid to AOI if provided ──────────────────────────────────────────
    if aoi_shp:
        clipped_grid = f"/tmp/{job_id}_grid_clipped.shp"
        _clip_grid(grid_path, aoi_shp, clipped_grid)
        grid_path = clipped_grid
        log.info("Grid clipped to AOI")

    # ── Zonal stats ───────────────────────────────────────────────────────────
    mymean_fn = _make_mymean(mymean_divisor, mymean_cap)

    # rasterstats uses 1-based band numbers
    stats = zonal_stats(
        grid_path,
        prob_raster,
        geojson_out=True,
        nodata=-999,
        all_touched=True,
        band=band_index + 1,   # convert 0-based to 1-based
        stats=["sum"],
        add_stats={"mymean": mymean_fn},
    )
    log.info("Zonal stats computed for %d cells", len(stats))

    # ── Save GeoJSON ──────────────────────────────────────────────────────────
    geojson_path = f"/tmp/{job_id}_fallas.geojson"
    fc = {"type": "FeatureCollection", "features": stats}
    with open(geojson_path, "w") as f:
        json.dump(fc, f)

    # ── Save Shapefile ────────────────────────────────────────────────────────
    shp_path = f"/tmp/{job_id}_fallas.shp"
    _geojson_to_shapefile(geojson_path, shp_path, epsg)
    zip_path = f"/tmp/{job_id}_fallas.zip"
    geo_utils.zip_shapefile(shp_path, zip_path)

    # ── Get bbox ──────────────────────────────────────────────────────────────
    bbox = geo_utils.get_bbox_4326(prob_raster)

    # ── Upload + register outputs ─────────────────────────────────────────────
    # 1. Probabilities raster (the band used for stats)
    cog_path = geo_utils.convert_to_cog(prob_raster, job_id, "fallas_cog")
    cog_gcs  = f"results/{job_id}/fallas_raster.tif"  # internal only
    geo_utils.upload_to_gcs(cog_path, cog_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="raster_cog",
        label="Raster de detección",
        gcs_path=cog_gcs, file_size=Path(cog_path).stat().st_size,
        is_visualizable=False, layer_type=None, epsg=epsg, bbox=bbox,
    )

    # 2. GeoJSON grid
    gj_gcs = f"results/{job_id}/fallas.geojson"
    geo_utils.upload_to_gcs(geojson_path, gj_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="geojson",
        label="Fault grid (GeoJSON)",
        gcs_path=gj_gcs, file_size=Path(geojson_path).stat().st_size,
        is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox,
    )

    # 3. Shapefile zip
    zip_gcs = f"results/{job_id}/fallas.zip"
    geo_utils.upload_to_gcs(zip_path, zip_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="shapefile",
        label="Fault grid (shapefile)",
        gcs_path=zip_gcs, file_size=Path(zip_path).stat().st_size,
        is_visualizable=False, layer_type=None,
    )

    # Summary stats
    total_cells   = len(stats)
    cells_w_falla = sum(1 for s in stats if (s.get("properties") or {}).get("mymean", 0) > 0)

    return [], {
        "total_cells":   total_cells,
        "cells_w_falla": cells_w_falla,
        "bbox":          bbox,
    }


# ── Grid helpers ──────────────────────────────────────────────────────────────

def _create_grid(output_path: str, xmin: float, xmax: float,
                 ymin: float, ymax: float, cell_size: float, epsg: int):
    """Creates a vector grid of square cells."""
    driver = ogr.GetDriverByName("ESRI Shapefile")
    if Path(output_path).exists():
        driver.DeleteDataSource(output_path)

    ds    = driver.CreateDataSource(output_path)
    srs   = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    layer = ds.CreateLayer(output_path, srs, geom_type=ogr.wkbPolygon)
    feat_defn = layer.GetLayerDefn()

    x = xmin
    while x < xmax:
        y = ymin
        while y < ymax:
            ring = ogr.Geometry(ogr.wkbLinearRing)
            ring.AddPoint(x,             y + cell_size)
            ring.AddPoint(x + cell_size, y + cell_size)
            ring.AddPoint(x + cell_size, y)
            ring.AddPoint(x,             y)
            ring.AddPoint(x,             y + cell_size)
            poly = ogr.Geometry(ogr.wkbPolygon)
            poly.AddGeometry(ring)
            feat = ogr.Feature(feat_defn)
            feat.SetGeometry(poly)
            layer.CreateFeature(feat)
            y += cell_size
        x += cell_size

    ds.Destroy()


def _clip_grid(grid_path: str, aoi_path: str, output_path: str):
    """Clips the grid shapefile to the AOI polygon."""
    grid = gpd.read_file(grid_path)
    aoi  = gpd.read_file(aoi_path)
    clipped = gpd.clip(grid, aoi)
    clipped.to_file(output_path)


def _make_mymean(divisor: int, cap: int):
    """Returns a zonal_stats add_stats function with the given parameters."""
    def mymean(x):
        y = np.sum(x)
        if y > 0:
            val = int(y / divisor)
            return min(val, cap)
        return 0
    return mymean


def _geojson_to_shapefile(geojson_path: str, shp_path: str, epsg: int):
    """Converts GeoJSON FeatureCollection to ESRI Shapefile."""
    import json as json_lib

    with open(geojson_path) as f:
        data = json_lib.load(f)

    driver = ogr.GetDriverByName("ESRI Shapefile")
    if Path(shp_path).exists():
        driver.DeleteDataSource(shp_path)

    ds    = driver.CreateDataSource(shp_path)
    srs   = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    layer = ds.CreateLayer("fallas", srs, ogr.wkbMultiPolygon)

    layer.CreateField(ogr.FieldDefn("suma",   ogr.OFTInteger))
    layer.CreateField(ogr.FieldDefn("fallas", ogr.OFTInteger))
    feat_defn = layer.GetLayerDefn()

    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        geom  = ogr.CreateGeometryFromJson(json_lib.dumps(feature["geometry"]))
        feat  = ogr.Feature(feat_defn)
        feat.SetGeometry(geom)
        feat.SetField("suma",   int(props.get("sum")    or 0))
        feat.SetField("fallas", int(props.get("mymean") or 0))
        layer.CreateFeature(feat)

    ds.Destroy()
