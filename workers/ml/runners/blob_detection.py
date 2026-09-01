import logging
import numpy as np
import cv2
import geojson
from pathlib import Path
import rasterio
import rasterio.windows
from osgeo import ogr, osr

import db
import geo_utils

log = logging.getLogger(__name__)

# Tile size for blob detection. Large enough to detect blobs well,
# small enough to keep memory bounded regardless of raster size.
BLOB_TILE_SIZE = 4096
# Overlap between tiles so blobs straddling a boundary are detected.
BLOB_OVERLAP   = 32


def run(job_id: str, prob_raster: str, cfg: dict, aoi_shp: str | None,
        epsg: int, geo_info: dict, clerk_id: str = "",
        progress_callback=None) -> tuple[list, dict]:

    log.info("Blob detection — job=%s  config=%s", job_id, cfg)

    # ── Build detector ────────────────────────────────────────────────────────
    params = cv2.SimpleBlobDetector_Params()
    params.minThreshold        = float(cfg.get("min_threshold", 0))
    params.maxThreshold        = float(cfg.get("max_threshold", 250))
    params.filterByArea        = True
    params.minArea             = float(cfg.get("min_area", 31))
    params.filterByCircularity = True
    params.minCircularity      = float(cfg.get("min_circularity", 0.1))
    params.filterByConvexity   = True
    params.minConvexity        = float(cfg.get("min_convexity", 0.1))
    params.filterByInertia     = True
    params.minInertiaRatio     = float(cfg.get("min_inertia_ratio", 0.1))
    detector = cv2.SimpleBlobDetector_create(params)

    # ── Tiled blob detection ──────────────────────────────────────────────────
    features = _detect_tiled(prob_raster, detector, progress_callback=progress_callback)
    log.info("Detected %d keypoints across all tiles", len(features))

    # ── Optional AOI clip ─────────────────────────────────────────────────────
    if aoi_shp and features:
        features = _clip_points_to_aoi(features, aoi_shp, points_epsg=epsg)
        log.info("After AOI clip: %d points", len(features))

    # ── Save GeoJSON ──────────────────────────────────────────────────────────
    geojson_path = f"/tmp/{job_id}_centroids.geojson"
    fc = geojson.FeatureCollection(features)
    with open(geojson_path, "w") as f:
        geojson.dump(fc, f)

    # ── Save Shapefile ────────────────────────────────────────────────────────
    shp_path = _save_point_shapefile(features, epsg, job_id)
    zip_path = f"/tmp/{job_id}_stand_count.zip"
    geo_utils.zip_shapefile(shp_path, zip_path)

    # ── bbox for map centering ────────────────────────────────────────────────
    bbox = geo_utils.get_bbox_4326(prob_raster)

    # ── Upload + register outputs (no probability raster exposed to user) ─────
    gj_gcs  = f"users/{clerk_id}/jobs/{job_id}/centroids.geojson"
    gj_size = geo_utils.upload_to_gcs(geojson_path, gj_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="geojson",
        label="Copas detectadas (GeoJSON)",
        gcs_path=gj_gcs, file_size=gj_size,
        is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox,
    )

    zip_gcs  = f"users/{clerk_id}/jobs/{job_id}/stand_count.zip"
    zip_size = geo_utils.upload_to_gcs(zip_path, zip_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="shapefile",
        label="Copas detectadas (Shapefile)",
        gcs_path=zip_gcs, file_size=zip_size,
        is_visualizable=False, layer_type=None,
    )

    # ── Density raster (COG) — for scalable web visualization ────────────────
    if features:
        try:
            density_path = geo_utils.points_to_density_cog(features, prob_raster, job_id)
            density_gcs  = f"users/{clerk_id}/jobs/{job_id}/density.tif"
            density_size = geo_utils.upload_to_gcs(density_path, density_gcs)
            db.insert_job_output(
                job_id=job_id, output_type="cog",
                label="Densidad de copas (raster)",
                gcs_path=density_gcs, file_size=density_size,
                is_visualizable=True, layer_type="raster", epsg=3857, bbox=bbox,
            )
            import os as _os
            try:
                _os.remove(density_path)
            except OSError:
                pass
            log.info("Density COG registered — %d points → %s", len(features), density_gcs)
        except Exception as e:
            log.warning("Density COG generation failed (non-fatal): %s", e)

    return [], {"count": len(features), "bbox": bbox}


def _detect_tiled(prob_raster: str, detector, progress_callback=None) -> list:
    """
    Run SimpleBlobDetector tile by tile, reading only one tile at a time
    from disk so memory stays bounded regardless of raster size.

    Tiles overlap by BLOB_OVERLAP pixels on each edge so blobs near a
    boundary are not missed. Keypoints in the trailing overlap strip are
    discarded (they will be picked up by the adjacent tile) to avoid
    duplicate detections.
    """
    features = []

    with rasterio.open(prob_raster) as src:
        W = src.width
        H = src.height
        transform = src.transform
        ulx  = transform.c
        uly  = transform.f
        xres = transform.a
        yres = transform.e  # negative

        step = BLOB_TILE_SIZE - BLOB_OVERLAP

        col_starts = list(range(0, W, step))
        row_starts = list(range(0, H, step))
        total_tiles = len(col_starts) * len(row_starts)
        done = 0

        for row0 in row_starts:
            for col0 in col_starts:
                tw = min(BLOB_TILE_SIZE, W - col0)
                th = min(BLOB_TILE_SIZE, H - row0)

                window = rasterio.windows.Window(col0, row0, tw, th)
                tile = src.read(1, window=window).astype(np.uint8)

                keypoints = detector.detect(255 - tile)

                # Whether this tile is the last in each direction
                last_col = (col0 + step) >= W
                last_row = (row0 + step) >= H

                for kp in keypoints:
                    lx, ly = kp.pt  # local pixel coords within tile

                    # Skip keypoints in the trailing overlap strip —
                    # the next tile will detect them without the offset
                    if not last_col and lx >= step:
                        continue
                    if not last_row and ly >= step:
                        continue

                    # Convert to global pixel then to geographic coords
                    gx = ulx + (col0 + lx) * xres
                    gy = uly + (row0 + ly) * yres
                    features.append(geojson.Feature(geometry=geojson.Point((gx, gy))))

                done += 1
                log.info("Blob detection tile %d/%d  keypoints_this_tile=%d",
                         done, total_tiles, len(keypoints))
                if progress_callback:
                    progress_callback(done, total_tiles)

    return features


def _clip_points_to_aoi(features: list, aoi_shp: str, points_epsg: int = None) -> list:
    from shapely.geometry import shape
    import geopandas as gpd
    aoi_gdf = gpd.read_file(aoi_shp)
    if points_epsg and aoi_gdf.crs and aoi_gdf.crs.to_epsg() != points_epsg:
        aoi_gdf = aoi_gdf.to_crs(epsg=points_epsg)
    aoi = aoi_gdf.unary_union
    return [f for f in features if shape(f["geometry"]).within(aoi)]


def _save_point_shapefile(features: list, epsg: int, job_id: str) -> str:
    shp_path = f"/tmp/{job_id}_centroids.shp"
    driver = ogr.GetDriverByName("ESRI Shapefile")
    if Path(shp_path).exists():
        driver.DeleteDataSource(shp_path)
    ds    = driver.CreateDataSource(shp_path)
    srs   = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    layer = ds.CreateLayer("centroids", srs, ogr.wkbPoint)
    feat_defn = layer.GetLayerDefn()
    for feat in features:
        coords = feat["geometry"]["coordinates"]
        geom   = ogr.Geometry(ogr.wkbPoint)
        geom.AddPoint(coords[0], coords[1])
        ogr_feat = ogr.Feature(feat_defn)
        ogr_feat.SetGeometry(geom)
        layer.CreateFeature(ogr_feat)
    ds.Destroy()
    return shp_path
