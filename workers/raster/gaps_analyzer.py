"""
workers/raster/gaps_analyzer.py
Gap / clearing detection for forest plantations.
- Uses NDVI if NIR band available (4-band), ExG otherwise (3-band RGB)
- Tile-based reading — no full array in RAM
- Outputs: probability COG + GeoJSON polygons + stats
"""

import os
import json
import tempfile
import numpy as np
from typing import Optional

GCS_BUCKET = os.getenv("GCS_BUCKET", "timbermap-data")

# Minimum gap area in square meters to report
MIN_GAP_AREA_M2 = 10.0
# Tile size for processing (pixels)
TILE_SIZE = 512


def detect_gaps(
    src_path: str,
    prob_cog_path: str,
    geojson_path: str,
    job_id: str,
    update_job_fn=None,
) -> dict:
    """
    Main entry point. src_path can be local or /vsigs/ path.
    Returns stats dict.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.crs import CRS
    from rasterio.features import shapes as rasterio_shapes
    from rasterio.warp import transform_geom
    from scipy import ndimage
    from osgeo import gdal
    gdal.UseExceptions()

    def _log(msg):
        if update_job_fn:
            update_job_fn(msg)

    _log("Opening image...")

    with rasterio.open(src_path) as src:
        num_bands = src.count
        width     = src.width
        height    = src.height
        transform = src.transform
        crs       = src.crs
        pixel_x   = abs(transform.a)
        pixel_y   = abs(transform.e)

        use_ndvi = num_bands >= 4
        _log(f"Image: {width}x{height}px, {num_bands} bands — using {'NDVI (NIR)' if use_ndvi else 'ExG (RGB)'}")

        # Compute pixel area in m2 — handle geographic CRS (degrees)
        if crs and crs.is_geographic:
            import math
            # Approximate: 1 degree latitude ≈ 111320m, longitude depends on lat
            center_lat = src.bounds.bottom + (src.bounds.top - src.bounds.bottom) / 2
            meter_per_deg_lat = 111320.0
            meter_per_deg_lon = 111320.0 * math.cos(math.radians(center_lat))
            pixel_area_m2 = pixel_x * meter_per_deg_lon * pixel_y * meter_per_deg_lat
        else:
            pixel_area_m2 = pixel_x * pixel_y  # projected CRS (meters)

        # Build vegetation index tile by tile
        _log("Computing vegetation index tile by tile...")
        veg_index = np.zeros((height, width), dtype=np.float32)

        for row_off in range(0, height, TILE_SIZE):
            row_end = min(row_off + TILE_SIZE, height)
            h = row_end - row_off
            for col_off in range(0, width, TILE_SIZE):
                col_end = min(col_off + TILE_SIZE, width)
                w = col_end - col_off

                window = rasterio.windows.Window(col_off, row_off, w, h)

                if use_ndvi:
                    # Band order: R=1, G=2, B=3, NIR=4
                    r   = src.read(1, window=window).astype(np.float32)
                    nir = src.read(4, window=window).astype(np.float32)
                    denom = nir + r
                    denom[denom == 0] = 1e-6
                    tile_idx = (nir - r) / denom  # NDVI: -1 to 1
                else:
                    # Excess Green Index: 2G - R - B
                    r = src.read(1, window=window).astype(np.float32)
                    g = src.read(2, window=window).astype(np.float32)
                    b = src.read(3, window=window).astype(np.float32)
                    # Normalize to 0-1 if uint8 or uint16
                    if src.dtypes[0] in ('uint8',):
                        r, g, b = r / 255.0, g / 255.0, b / 255.0
                    elif src.dtypes[0] in ('uint16',):
                        r, g, b = r / 65535.0, g / 65535.0, b / 65535.0
                    tile_idx = 2 * g - r - b  # ExG: roughly -1 to 2

                veg_index[row_off:row_end, col_off:col_end] = tile_idx

    _log("Thresholding and cleaning...")

    # Normalize to 0-1 probability of being a gap (low vegetation = high gap prob)
    if use_ndvi:
        # NDVI < 0.2 = likely gap/bare soil
        threshold = 0.2
        # gap probability: invert and clip
        gap_prob = np.clip((threshold - veg_index) / (threshold + 0.5), 0, 1)
    else:
        # ExG < 0.05 = likely gap
        threshold = 0.05
        gap_prob = np.clip((threshold - veg_index) / (threshold + 0.3), 0, 1)

    # Binary mask of gaps
    gap_mask = (gap_prob > 0.5).astype(np.uint8)

    # Morphological cleaning: remove tiny noise, fill small holes
    struct = ndimage.generate_binary_structure(2, 2)
    gap_mask = ndimage.binary_opening(gap_mask, structure=struct, iterations=2).astype(np.uint8)
    gap_mask = ndimage.binary_closing(gap_mask, structure=struct, iterations=2).astype(np.uint8)

    _log("Extracting gap polygons...")

    # Label connected components
    labeled, num_features = ndimage.label(gap_mask)
    min_pixels = max(1, int(MIN_GAP_AREA_M2 / pixel_area_m2))

    # Filter small components
    for label_id in range(1, num_features + 1):
        component = labeled == label_id
        if component.sum() < min_pixels:
            gap_mask[component] = 0

    # Re-label after filtering
    labeled, num_features = ndimage.label(gap_mask)

    # Extract polygons via rasterio.features.shapes
    features = []
    with rasterio.open(src_path) as src:
        src_crs = src.crs

    for geom, val in rasterio_shapes(gap_mask, mask=gap_mask, transform=transform):
        if val == 0:
            continue
        # Reproject to WGS84 for GeoJSON
        if src_crs and src_crs.to_epsg() != 4326:
            geom_wgs84 = transform_geom(src_crs, CRS.from_epsg(4326), geom)
        else:
            geom_wgs84 = geom

        # Compute area in m2 (rough approximation from pixel count)
        pixel_count = (labeled == int(val)).sum() if val > 0 else 0
        area_m2 = float(pixel_count) * pixel_area_m2

        features.append({
            "type": "Feature",
            "geometry": geom_wgs84,
            "properties": {
                "area_m2": round(area_m2, 1),
                "area_ha": round(area_m2 / 10000, 4),
            }
        })

    # Stats
    total_pixels   = width * height
    gap_pixels     = int(gap_mask.sum())
    gap_pct        = round(gap_pixels / total_pixels * 100, 2) if total_pixels > 0 else 0
    total_area_ha  = round(total_pixels * pixel_area_m2 / 10000, 2)
    gap_area_ha    = round(gap_pixels  * pixel_area_m2 / 10000, 2)
    gap_count      = len(features)
    avg_gap_ha     = round(gap_area_ha / gap_count, 4) if gap_count > 0 else 0

    stats = {
        "vegetation_index": "NDVI" if use_ndvi else "ExG",
        "total_area_ha":    total_area_ha,
        "gap_area_ha":      gap_area_ha,
        "gap_pct":          gap_pct,
        "gap_count":        gap_count,
        "avg_gap_ha":       avg_gap_ha,
        "min_gap_area_m2":  MIN_GAP_AREA_M2,
    }

    _log(f"Found {gap_count} gaps — {gap_pct}% of area")

    # Write GeoJSON
    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "properties": stats,
    }
    with open(geojson_path, "w") as f:
        json.dump(geojson, f)

    # Write probability COG
    _log("Writing probability raster (COG)...")
    tmp_tif = prob_cog_path + "_tmp.tif"
    with rasterio.open(
        tmp_tif, "w",
        driver="GTiff",
        height=height, width=width,
        count=1, dtype="float32",
        crs=crs, transform=transform,
        compress="deflate",
    ) as dst:
        # Write in tiles
        for row_off in range(0, height, TILE_SIZE):
            row_end = min(row_off + TILE_SIZE, height)
            h = row_end - row_off
            for col_off in range(0, width, TILE_SIZE):
                col_end = min(col_off + TILE_SIZE, width)
                w = col_end - col_off
                window = rasterio.windows.Window(col_off, row_off, w, h)
                dst.write(
                    gap_prob[row_off:row_end, col_off:col_end][np.newaxis, :, :],
                    window=window
                )

    # Convert to COG in EPSG:3857
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
        warpMemoryLimit=512,
        multithread=True,
    )
    result = gdal.Warp(prob_cog_path, tmp_tif, options=warp_opts)
    result.FlushCache()
    result = None
    if os.path.exists(tmp_tif):
        os.remove(tmp_tif)

    return stats
