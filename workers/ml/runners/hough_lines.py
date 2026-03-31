import logging
import numpy as np
import cv2
from pathlib import Path
import rasterio
from osgeo import gdal, osr, ogr
import geopandas as gpd
from shapely.geometry import Point
import json

try:
    from skimage.morphology import skeletonize_3d
except ImportError:
    from skimage.morphology import skeletonize as skeletonize_3d
from skimage.transform import hough_line, hough_line_peaks

import db
import geo_utils

log = logging.getLogger(__name__)


def run(job_id: str, prob_raster: str, cfg: dict, aoi_shp: str | None,
        epsg: int, geo_info: dict, image_name: str = "output") -> tuple[list, dict]:

    log.info("Hough lines — job=%s  config=%s", job_id, cfg)

    threshold    = int(cfg.get("threshold", 200))
    morph_kernel = int(cfg.get("morph_kernel", 11))
    cellsize     = int(cfg.get("cellsize", 250))
    hough_min_dist  = int(cfg.get("hough_min_distance", 15))
    hough_min_angle = int(cfg.get("hough_min_angle", 10))
    hough_peaks     = int(cfg.get("hough_num_peaks", 15))

    # ── Load probabilities raster with rasterio ───────────────────────────────
    with rasterio.open(prob_raster) as src:
        img = src.read(1).astype(np.uint8)
        transform = src.transform
        W, H = src.width, src.height
        ulx  = transform.c
        uly  = transform.f
        xres = abs(transform.a)
        yres = abs(transform.e)

    gt = (ulx, xres, 0, uly, 0, -yres)

    # ── Phase 2a: binarize → morph close → skeletonize ───────────────────────
    _, img = cv2.threshold(img, threshold, 255, cv2.THRESH_BINARY)
    kernel = np.ones((morph_kernel, morph_kernel), np.uint8)
    img    = cv2.morphologyEx(img, cv2.MORPH_CLOSE, kernel)

    if np.amax(img) == 0:
        raise ValueError("Empty output after thresholding")

    img = (skeletonize_3d(img / 255) * 255).astype(np.uint8)

    # ── Save skeleton raster ──────────────────────────────────────────────────
    skeleton_path = f"/tmp/{job_id}_skeleton.tif"
    _save_raster(skeleton_path, img, gt, W, H, epsg)

    # ── Hough line detection ──────────────────────────────────────────────────
    im_size = (H, W)
    points  = _run_hough_cells(img, im_size, cellsize, hough_min_dist,
                                hough_min_angle, hough_peaks)
    log.info("Hough detected %d transect points", len(points))

    if not points:
        raise ValueError("No lines detected")

    pixel_size_avg = (xres + yres) / 2
    geo_points = _scale_points(points, ulx, uly, W, H, xres, yres, pixel_size_avg)

    gdf = gpd.GeoDataFrame(
        [{"geometry": Point(p[0], p[1]), "dist": p[2]} for p in geo_points],
        crs=f"EPSG:{epsg}",
    )

    aoi_gdf = None
    if aoi_shp:
        gdf, aoi_gdf = _clip_and_stats(gdf, aoi_shp, epsg)

    if len(gdf) > 10:
        p25  = gdf["dist"].quantile(0.025)
        p975 = gdf["dist"].quantile(0.975)
        gdf  = gdf[(gdf["dist"] > p25) & (gdf["dist"] < p975)]

    shp_path = f"/tmp/{job_id}_transectas.shp"
    gdf.to_file(shp_path)
    zip_path = f"/tmp/{job_id}_transectas.zip"
    geo_utils.zip_shapefile(shp_path, zip_path)

    bbox = geo_utils.get_bbox_4326(prob_raster)

    cog1     = geo_utils.convert_to_cog(prob_raster, job_id, "prob_cog")
    cog1_gcs = f"results/{job_id}/probabilities.tif"  # internal only
    geo_utils.upload_to_gcs(cog1, cog1_gcs)
    db.insert_job_output(job_id=job_id, output_type="raster_cog",
        label="Raster de probabilidades", gcs_path=cog1_gcs,
        file_size=Path(cog1).stat().st_size,
        is_visualizable=False, layer_type=None, epsg=epsg, bbox=bbox)

    cog2     = geo_utils.convert_to_cog(skeleton_path, job_id, "skeleton_cog")
    cog2_gcs = f"results/{job_id}/{image_name}_skeleton.tif"
    geo_utils.upload_to_gcs(cog2, cog2_gcs)
    db.insert_job_output(job_id=job_id, output_type="raster_cog",
        label=f"{image_name} — Esqueleto de líneas", gcs_path=cog2_gcs,
        file_size=Path(cog2).stat().st_size,
        is_visualizable=True, layer_type="raster", epsg=epsg, bbox=bbox)

    zip_gcs = f"results/{job_id}/{image_name}_transectas.zip"
    geo_utils.upload_to_gcs(zip_path, zip_gcs)
    db.insert_job_output(job_id=job_id, output_type="shapefile",
        label=f"{image_name} — Transectas", gcs_path=zip_gcs,
        file_size=Path(zip_path).stat().st_size,
        is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox)

    if aoi_gdf is not None and len(aoi_gdf) > 0:
        aoi_shp_out = f"/tmp/{job_id}_aoi_stats.shp"
        aoi_gdf.to_file(aoi_shp_out)
        aoi_zip = f"/tmp/{job_id}_aoi_stats.zip"
        geo_utils.zip_shapefile(aoi_shp_out, aoi_zip)
        aoi_gcs = f"results/{job_id}/{image_name}_aoi_stats.zip"
        geo_utils.upload_to_gcs(aoi_zip, aoi_gcs)
        db.insert_job_output(job_id=job_id, output_type="shapefile",
            label=f"{image_name} — Stats por rodal", gcs_path=aoi_gcs,
            file_size=Path(aoi_zip).stat().st_size,
            is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox)

    mean_dist = float(gdf["dist"].mean()) if len(gdf) > 0 else 0
    return [], {"point_count": len(gdf), "mean_dist_m": round(mean_dist, 2), "bbox": bbox}


def _run_hough_cells(img, im_size, cellsize, min_dist, min_angle, num_peaks):
    H, W = im_size
    points = []
    tested_angles = np.linspace(-np.pi / 2, np.pi / 2, 360)
    for i in range(H // cellsize):
        for j in range(W // cellsize):
            clip = img[i*cellsize:(i+1)*cellsize, j*cellsize:(j+1)*cellsize]
            if np.amax(clip) == 0:
                continue
            lines = _find_hough_lines(clip, tested_angles, min_dist, min_angle, num_peaks)
            if len(lines) > 1:
                dists = _calc_distances(lines, i*cellsize, j*cellsize, cellsize)
                points.extend(dists)
    return points


def _find_hough_lines(img_clip, tested_angles, min_dist, min_angle, num_peaks):
    _, img_bin = cv2.threshold(img_clip, 230, 255, cv2.THRESH_BINARY)
    h, theta, d = hough_line(img_bin, theta=tested_angles)
    out = hough_line_peaks(h, theta, d, min_distance=min_dist,
                           min_angle=min_angle, threshold=None, num_peaks=num_peaks)
    return list(zip(*out)) if out[0].size > 0 else []


def _calc_distances(lines, row_offset, col_offset, cellsize=250):
    points = []
    half = cellsize // 2
    for i, (_, angle_i, dist_i) in enumerate(lines):
        for j, (_, angle_j, dist_j) in enumerate(lines):
            if i >= j:
                continue
            if abs(angle_i - angle_j) < 0.1:
                d = abs(dist_i - dist_j)
                if 1.8 < d < 50:
                    # Center of the cell, not a wrong len() call
                    mid_x = col_offset + half
                    mid_y = row_offset + half
                    points.append((mid_x, mid_y, d))
    return points


def _scale_points(points, ulx, uly, W, H, xres, yres, pixel_size):
    result = []
    for px, py, dist_px in points:
        x_geo  = ulx + px * xres
        y_geo  = uly - py * yres
        dist_m = dist_px * pixel_size  # dist_px in pixels × pixel_size m/px = metres
        result.append((x_geo, y_geo, round(dist_m, 2)))
    return result


def _clip_and_stats(gdf, aoi_shp, epsg):
    aoi = gpd.read_file(aoi_shp)

    # Reproject AOI to match points CRS (points are always in EPSG of the COG,
    # but the user's shapefile may be in a different EPSG)
    if aoi.crs is None:
        aoi = aoi.set_crs(epsg=epsg)
    elif aoi.crs.to_epsg() != epsg:
        aoi = aoi.to_crs(epsg=epsg)

    # Use "intersects" not "within" — matches original behavior and avoids
    # edge points being dropped due to floating point boundary issues
    clipped = gpd.sjoin(gdf, aoi, how="inner", predicate="intersects")

    # Drop duplicate index_right if multiple AOI polygons matched same point
    clipped = clipped[~clipped.index.duplicated(keep="first")]

    rodal_stats = None
    if "CD_USO_SOLO" in aoi.columns and "RODAL" in aoi.columns:
        stats_rows = []
        for _, rodal in aoi.iterrows():
            mask   = clipped.geometry.within(rodal.geometry)
            subset = clipped[mask]["dist"]
            if len(subset) == 0:
                continue
            stats_rows.append({
                "geometry":    rodal.geometry,
                "RODAL":       rodal.get("RODAL"),
                "CD_USO_SOLO": rodal.get("CD_USO_SOLO"),
                "GE_ABREV":    rodal.get("GE_ABREV", ""),
                "Dist_media":  round(float(subset.mean()), 2),
                "Desv_estan":  round(float(subset.std()), 2),
                "Dist_max":    round(float(subset.max()), 2),
                "Dist_min":    round(float(subset.min()), 2),
            })
        if stats_rows:
            rodal_stats = gpd.GeoDataFrame(stats_rows, crs=f"EPSG:{epsg}")
    return clipped[["geometry", "dist"]], rodal_stats


def _save_raster(path, arr, gt, W, H, epsg):
    import rasterio
    from rasterio.transform import Affine
    from rasterio.crs import CRS
    transform = Affine(gt[1], gt[2], gt[0], gt[4], gt[5], gt[3])
    with rasterio.open(
        path, 'w', driver='GTiff',
        height=H, width=W, count=1, dtype='uint8',
        crs=CRS.from_epsg(epsg), transform=transform,
        compress='deflate',
    ) as dst:
        dst.write(arr[:H, :W], 1)
