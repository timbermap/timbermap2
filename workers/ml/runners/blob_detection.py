import logging
import numpy as np
import cv2
import geojson
from pathlib import Path
import rasterio
from osgeo import ogr, osr

import db
import geo_utils

log = logging.getLogger(__name__)


def run(job_id: str, prob_raster: str, cfg: dict, aoi_shp: str | None,
        epsg: int, geo_info: dict) -> tuple[list, dict]:

    log.info("Blob detection — job=%s  config=%s", job_id, cfg)

    # ── Load probability raster ───────────────────────────────────────────────
    with rasterio.open(prob_raster) as src:
        img       = src.read(1).astype(np.uint8)
        transform = src.transform
        ulx  = transform.c
        uly  = transform.f
        xres = transform.a
        yres = transform.e   # negative

    # ── SimpleBlobDetector ────────────────────────────────────────────────────
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

    detector  = cv2.SimpleBlobDetector_create(params)
    keypoints = detector.detect(255 - img)
    log.info("Detected %d keypoints", len(keypoints))

    # ── Convert pixel → geographic coords (in raster native EPSG) ────────────
    # No reprojection here — outputs stay in image EPSG for consistency
    # MapLibre will reproject client-side for visualization
    features = []
    for kp in keypoints:
        px, py = kp.pt
        x_geo  = ulx + px * xres
        y_geo  = uly + py * yres
        features.append(geojson.Feature(geometry=geojson.Point((x_geo, y_geo))))

    # ── Optional AOI clip ─────────────────────────────────────────────────────
    if aoi_shp and features:
        features = _clip_points_to_aoi(features, aoi_shp, points_epsg=epsg)
        log.info("After AOI clip: %d points", len(features))

    # ── Save GeoJSON (in raster native EPSG) ──────────────────────────────────
    geojson_path = f"/tmp/{job_id}_centroids.geojson"
    fc = geojson.FeatureCollection(features)
    with open(geojson_path, "w") as f:
        geojson.dump(fc, f)

    # ── Save Shapefile (in raster native EPSG) ────────────────────────────────
    shp_path = _save_point_shapefile(features, epsg, job_id)
    zip_path = f"/tmp/{job_id}_stand_count.zip"
    geo_utils.zip_shapefile(shp_path, zip_path)

    # ── Get bbox in 4326 for map centering ────────────────────────────────────
    bbox = geo_utils.get_bbox_4326(prob_raster)

    # ── Upload + register outputs ─────────────────────────────────────────────
    cog_path = geo_utils.convert_to_cog(prob_raster, job_id, "probabilities_cog")
    cog_gcs  = f"results/{job_id}/probabilities.tif"
    cog_size = geo_utils.upload_to_gcs(cog_path, cog_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="raster_cog",
        label="Raster de probabilidades",
        gcs_path=cog_gcs, file_size=cog_size,
        is_visualizable=True, layer_type="raster", epsg=epsg, bbox=bbox,
    )

    gj_gcs  = f"results/{job_id}/centroids.geojson"
    gj_size = geo_utils.upload_to_gcs(geojson_path, gj_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="geojson",
        label="Copas detectadas (GeoJSON)",
        gcs_path=gj_gcs, file_size=gj_size,
        is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox,
    )

    zip_gcs  = f"results/{job_id}/stand_count.zip"
    zip_size = geo_utils.upload_to_gcs(zip_path, zip_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="shapefile",
        label="Copas detectadas (Shapefile)",
        gcs_path=zip_gcs, file_size=zip_size,
        is_visualizable=False, layer_type=None,
    )

    return [], {"count": len(features), "bbox": bbox}


def _clip_points_to_aoi(features: list, aoi_shp: str, points_epsg: int = None) -> list:
    from shapely.geometry import shape
    import geopandas as gpd
    aoi_gdf = gpd.read_file(aoi_shp)
    # Reproject AOI to match points CRS if needed
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
