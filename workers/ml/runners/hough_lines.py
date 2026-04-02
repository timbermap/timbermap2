import logging
import numpy as np
import cv2
from pathlib import Path
import rasterio
from shapely.geometry import Point, box
import geopandas as gpd

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

    threshold       = int(cfg.get("threshold", 200))
    morph_kernel    = int(cfg.get("morph_kernel", 11))
    cellsize        = int(cfg.get("cellsize", 250))
    hough_min_dist  = int(cfg.get("hough_min_distance", 15))
    hough_min_angle = int(cfg.get("hough_min_angle", 10))
    hough_peaks     = int(cfg.get("hough_num_peaks", 15))
    grid_size_m     = int(cfg.get("grid_size_m", 100))   # side of each output grid cell

    # ── Load probabilities raster ─────────────────────────────────────────────
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

    # ── Build points GeoDataFrame ─────────────────────────────────────────────
    gdf = gpd.GeoDataFrame(
        [{"geometry": Point(p[0], p[1]), "dist": p[2]} for p in geo_points],
        crs=f"EPSG:{epsg}",
    )

    # ── AOI processing: clip points + build grid ──────────────────────────────
    grid_gdf = None
    if aoi_shp:
        gdf, grid_gdf = _clip_and_build_grid(gdf, aoi_shp, epsg, grid_size_m)

    # ── Percentile filter (remove extreme outliers) ───────────────────────────
    if len(gdf) > 10:
        p25  = gdf["dist"].quantile(0.025)
        p975 = gdf["dist"].quantile(0.975)
        gdf  = gdf[(gdf["dist"] > p25) & (gdf["dist"] < p975)]

    # ── Register outputs ──────────────────────────────────────────────────────
    bbox = geo_utils.get_bbox_4326(prob_raster)

    # Output 1 — Probability raster: uploaded but NOT visualizable (in memory only)
    cog1     = geo_utils.convert_to_cog(prob_raster, job_id, "prob_cog")
    cog1_gcs = f"results/{job_id}/probabilities.tif"
    geo_utils.upload_to_gcs(cog1, cog1_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="raster_cog",
        label="Raster de probabilidades", gcs_path=cog1_gcs,
        file_size=Path(cog1).stat().st_size,
        is_visualizable=False, layer_type=None, epsg=epsg, bbox=bbox,
    )

    # Output 2 — Skeleton raster: visible
    cog2     = geo_utils.convert_to_cog(skeleton_path, job_id, "skeleton_cog")
    cog2_gcs = f"results/{job_id}/{image_name}_skeleton.tif"
    geo_utils.upload_to_gcs(cog2, cog2_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="raster_cog",
        label=f"{image_name} — Esqueleto de líneas", gcs_path=cog2_gcs,
        file_size=Path(cog2).stat().st_size,
        is_visualizable=True, layer_type="raster", epsg=epsg, bbox=bbox,
    )

    # Output 3 — Points shapefile: visible
    # Fields: geometry, dist  (+ CD_USO_SOLO, GE_ABREV when shape is present)
    shp_path = f"/tmp/{job_id}_transectas.shp"
    gdf.to_file(shp_path)
    zip_path = f"/tmp/{job_id}_transectas.zip"
    geo_utils.zip_shapefile(shp_path, zip_path)
    zip_gcs = f"results/{job_id}/{image_name}_transectas.zip"
    geo_utils.upload_to_gcs(zip_path, zip_gcs)
    db.insert_job_output(
        job_id=job_id, output_type="shapefile",
        label=f"{image_name} — Transectas", gcs_path=zip_gcs,
        file_size=Path(zip_path).stat().st_size,
        is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox,
    )

    # Output 4 — Grid with stats: visible, only when shape is provided
    # Fields: geometry, n_puntos, Dist_media, Desv_estan, Dist_max, Dist_min
    #         (+ RODAL, CD_SGF, CD_USO_SOLO, GE_ABREV when AOI has them)
    if grid_gdf is not None and len(grid_gdf) > 0:
        grid_shp = f"/tmp/{job_id}_grid.shp"
        grid_gdf.to_file(grid_shp)
        grid_zip = f"/tmp/{job_id}_grid.zip"
        geo_utils.zip_shapefile(grid_shp, grid_zip)
        grid_gcs = f"results/{job_id}/{image_name}_grid.zip"
        geo_utils.upload_to_gcs(grid_zip, grid_gcs)
        db.insert_job_output(
            job_id=job_id, output_type="shapefile",
            label=f"{image_name} — Grilla de estadísticas ({grid_size_m}m)",
            gcs_path=grid_gcs,
            file_size=Path(grid_zip).stat().st_size,
            is_visualizable=True, layer_type="vector", epsg=epsg, bbox=bbox,
        )

    mean_dist = float(gdf["dist"].mean()) if len(gdf) > 0 else 0
    return [], {
        "point_count": len(gdf),
        "mean_dist_m": round(mean_dist, 2),
        "bbox": bbox,
    }


# ── Hough helpers ─────────────────────────────────────────────────────────────

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


def _line_midpoint_in_cell(angle: float, rho: float, cellsize: int) -> tuple[float, float]:
    """
    Return the midpoint (col, row) of the Hough line segment that lies within
    the [0, cellsize] × [0, cellsize] pixel cell.

    Skimage convention: rho = col*cos(angle) + row*sin(angle)
    """
    cos_t = np.cos(angle)
    sin_t = np.sin(angle)
    eps   = 1e-9
    pts: list[tuple[float, float]] = []

    # Intersection at col = 0 and col = cellsize
    if abs(sin_t) > eps:
        r = rho / sin_t
        if 0.0 <= r <= cellsize:
            pts.append((0.0, r))
        r = (rho - cellsize * cos_t) / sin_t
        if 0.0 <= r <= cellsize:
            pts.append((float(cellsize), r))

    # Intersection at row = 0 and row = cellsize
    if abs(cos_t) > eps:
        c = rho / cos_t
        if 0.0 <= c <= cellsize:
            pts.append((c, 0.0))
        c = (rho - cellsize * sin_t) / cos_t
        if 0.0 <= c <= cellsize:
            pts.append((c, float(cellsize)))

    # Deduplicate points that are too close (corner intersections)
    unique: list[tuple[float, float]] = []
    for p in pts:
        if not any(abs(p[0] - q[0]) < 0.5 and abs(p[1] - q[1]) < 0.5 for q in unique):
            unique.append(p)

    if len(unique) < 2:
        # Fallback: foot of perpendicular from origin, clamped to cell
        foot_col = np.clip(rho * cos_t, 0, cellsize)
        foot_row = np.clip(rho * sin_t, 0, cellsize)
        return float(foot_col), float(foot_row)

    # Midpoint of the visible segment
    return (unique[0][0] + unique[1][0]) / 2.0, (unique[0][1] + unique[1][1]) / 2.0


def _calc_distances(lines, row_offset: int, col_offset: int, cellsize: int = 250):
    """
    For each pair of parallel lines in the cell, compute the perpendicular
    inter-line distance (in pixels) and place the measurement point ON line_i
    (midpoint of the line segment within the cell), not at the cell centre.
    """
    points = []
    for i, (_, angle_i, dist_i) in enumerate(lines):
        for j, (_, angle_j, dist_j) in enumerate(lines):
            if i >= j:
                continue
            # Only pair roughly parallel lines
            if abs(angle_i - angle_j) < 0.1:
                # Perpendicular distance in Hough space = |rho_i - rho_j|
                d = abs(dist_i - dist_j)
                if 1.8 < d < 50:
                    # Place point on the actual line, not the cell centre
                    mid_col, mid_row = _line_midpoint_in_cell(angle_i, dist_i, cellsize)
                    px = col_offset + mid_col   # absolute pixel column
                    py = row_offset + mid_row   # absolute pixel row
                    points.append((px, py, d))
    return points


def _scale_points(points, ulx, uly, W, H, xres, yres, pixel_size):
    """Convert (pixel_col, pixel_row, dist_px) → (geo_x, geo_y, dist_m)."""
    result = []
    for px, py, dist_px in points:
        x_geo  = ulx + px * xres
        y_geo  = uly - py * yres
        dist_m = dist_px * pixel_size      # pixels × m/pixel = metres
        result.append((x_geo, y_geo, round(dist_m, 2)))
    return result


# ── AOI / grid helpers ────────────────────────────────────────────────────────

def _clip_and_build_grid(
    gdf: gpd.GeoDataFrame,
    aoi_shp: str,
    epsg: int,
    grid_size_m: int,
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame | None]:
    """
    1. Reproject AOI to match points CRS.
    2. Clip points to AOI; attach CD_USO_SOLO / GE_ABREV when available.
    3. Build a regular fishnet grid of grid_size_m metres over the AOI extent.
    4. Compute per-cell statistics from the clipped points.
    5. Enrich grid cells with RODAL / CD_SGF / CD_USO_SOLO / GE_ABREV
       via spatial join to the AOI (when those columns exist).
    6. Clip grid to the AOI union shape.

    Returns
    -------
    clipped_points : GeoDataFrame
        Points inside AOI.  Fields: geometry, dist [, CD_USO_SOLO, GE_ABREV]
    grid : GeoDataFrame | None
        Grid cells with statistics, or None when no points fall in the grid.
        Fields: geometry, n_puntos, Dist_media, Desv_estan, Dist_max, Dist_min
                [, RODAL, CD_SGF, CD_USO_SOLO, GE_ABREV]
    """
    aoi = gpd.read_file(aoi_shp)
    if aoi.crs is None:
        aoi = aoi.set_crs(epsg=epsg)
    elif aoi.crs.to_epsg() != epsg:
        aoi = aoi.to_crs(epsg=epsg)

    has_forest_cols = ("CD_USO_SOLO" in aoi.columns and "RODAL" in aoi.columns)

    # ── 1. Clip points + attach AOI attributes ────────────────────────────────
    joined = gpd.sjoin(gdf, aoi, how="inner", predicate="intersects")
    joined = joined[~joined.index.duplicated(keep="first")]

    # Fields to keep on the points file
    point_cols = ["geometry", "dist"]
    if has_forest_cols:
        if "CD_USO_SOLO" in joined.columns:
            point_cols.append("CD_USO_SOLO")
        if "GE_ABREV" in joined.columns:
            point_cols.append("GE_ABREV")

    clipped = joined[[c for c in point_cols if c in joined.columns]].copy()

    # ── 2. Fishnet grid over AOI extent ──────────────────────────────────────
    minx, miny, maxx, maxy = aoi.total_bounds
    xs = np.arange(minx, maxx, grid_size_m)
    ys = np.arange(miny, maxy, grid_size_m)
    grid_cells = [
        box(x, y, x + grid_size_m, y + grid_size_m)
        for x in xs for y in ys
    ]
    grid_base = gpd.GeoDataFrame(
        {"cell_id": range(len(grid_cells)), "geometry": grid_cells},
        crs=f"EPSG:{epsg}",
    )

    # ── 3. Per-cell statistics ────────────────────────────────────────────────
    pts_in_cells = gpd.sjoin(
        clipped[["geometry", "dist"]],
        grid_base,
        how="inner",
        predicate="within",
    )

    stats_rows = []
    for cell_id, group in pts_in_cells.groupby("cell_id"):
        dists = group["dist"]
        cell_geom = grid_base.loc[grid_base["cell_id"] == cell_id, "geometry"].iloc[0]
        stats_rows.append({
            "geometry":   cell_geom,
            "n_puntos":   int(len(dists)),
            "Dist_media": round(float(dists.mean()), 2),
            "Desv_estan": round(float(dists.std(ddof=0)), 2),
            "Dist_max":   round(float(dists.max()), 2),
            "Dist_min":   round(float(dists.min()), 2),
        })

    if not stats_rows:
        return clipped, None

    grid_stats = gpd.GeoDataFrame(stats_rows, crs=f"EPSG:{epsg}")

    # ── 4. Enrich grid with forest attributes (when AOI has them) ────────────
    if has_forest_cols:
        aoi_attr_cols = ["geometry", "RODAL", "CD_USO_SOLO"]
        for col in ("CD_SGF", "GE_ABREV"):          # include when present
            if col in aoi.columns:
                aoi_attr_cols.append(col)

        aoi_attrs = aoi[[c for c in aoi_attr_cols if c in aoi.columns]].copy()
        grid_stats = gpd.sjoin(grid_stats, aoi_attrs, how="left", predicate="intersects")
        grid_stats = grid_stats[~grid_stats.index.duplicated(keep="first")]
        grid_stats = grid_stats.drop(columns=["index_right"], errors="ignore")

    # ── 5. Clip grid to AOI shape ─────────────────────────────────────────────
    try:
        aoi_union = aoi.geometry.union_all()
    except AttributeError:                          # geopandas < 0.14
        aoi_union = aoi.geometry.unary_union

    grid_stats = grid_stats[grid_stats.geometry.intersects(aoi_union)].copy()
    grid_stats["geometry"] = grid_stats.geometry.intersection(aoi_union)
    grid_stats = grid_stats[~grid_stats.geometry.is_empty].copy()

    return clipped, grid_stats


# ── Raster I/O helper ─────────────────────────────────────────────────────────

def _save_raster(path: str, arr: np.ndarray, gt: tuple, W: int, H: int, epsg: int):
    from rasterio.transform import Affine
    from rasterio.crs import CRS
    transform = Affine(gt[1], gt[2], gt[0], gt[4], gt[5], gt[3])
    with rasterio.open(
        path, "w", driver="GTiff",
        height=H, width=W, count=1, dtype="uint8",
        crs=CRS.from_epsg(epsg), transform=transform,
        compress="deflate",
    ) as dst:
        dst.write(arr[:H, :W], 1)
