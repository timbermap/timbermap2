import logging
import numpy as np
# Use rasterio instead of GDAL directly to avoid _gdal_array issues
import rasterio
from osgeo import gdal, osr

log = logging.getLogger(__name__)


def run_tile_inference(
    src_path: str,
    model,
    means: np.ndarray,
    stds: np.ndarray,
    tile_size: int,
    model_input_size: int,
    n_bands: int,
    n_output_bands: int,
    job_id: str,
    progress_callback=None,
) -> str:
    """
    Runs U-Net inference tile by tile using rasterio for reading
    and GDAL for writing the output raster.
    """
    # Use rasterio to read — avoids gdal_array dependency
    with rasterio.open(src_path) as src:
        W = src.width
        H = src.height
        profile = src.profile
        crs = src.crs
        transform = src.transform

    log.info("Image size: %dx%d  bands=%d  tile_size=%d  model_input=%d",
             W, H, n_bands, tile_size, model_input_size)

    # Write output with rasterio too
    out_path = f"/tmp/{job_id}_probabilities.tif"
    out_profile = {
        "driver": "GTiff",
        "dtype": "uint8",
        "width": W,
        "height": H,
        "count": n_output_bands,
        "crs": crs,
        "transform": transform,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "bigtiff": "YES",
    }

    cols = list(range(0, W, tile_size))
    rows = list(range(0, H, tile_size))
    total = len(cols) * len(rows)
    done  = 0

    with rasterio.open(src_path) as src, rasterio.open(out_path, "w", **out_profile) as dst:
        for row in rows:
            for col in cols:
                tw = min(tile_size, W - col)
                th = min(tile_size, H - row)

                # Read tile — shape: (n_bands, th, tw)
                window = rasterio.windows.Window(col, row, tw, th)
                tile_data = src.read(window=window)  # (bands, h, w)

                # Pad to model_input_size and reshape to (h, w, bands)
                tile = np.zeros(
                    (model_input_size, model_input_size, n_bands),
                    dtype=np.float32
                )
                for b in range(min(n_bands, tile_data.shape[0])):
                    tile[:th, :tw, b] = tile_data[b].astype(np.float32)

                # Normalize
                tile = ((tile - means.astype(np.float32)) /
                        stds.astype(np.float32))

                # Predict
                inp  = tile.reshape(1, model_input_size, model_input_size, n_bands)
                pred = model.predict(inp, batch_size=1, verbose=0)
                # pred shape: (1, model_input_size, model_input_size, n_output_bands)

                # Write each output band
                for b in range(n_output_bands):
                    result = (pred[0, :th, :tw, b] * 255).clip(0, 255).astype(np.uint8)
                    dst.write(result, b + 1, window=window)

                done += 1
                if progress_callback and done % 50 == 0:
                    progress_callback(done, total)

    log.info("Tile inference complete — %d tiles → %s", total, out_path)
    return out_path


def get_epsg(src_path: str) -> int:
    """Extracts the EPSG code from a raster file using rasterio."""
    with rasterio.open(src_path) as src:
        crs = src.crs
    if crs and crs.to_epsg():
        return crs.to_epsg()
    return 4326


def get_geotransform_info(src_path: str) -> dict:
    """Returns extent and pixel size for a raster using rasterio."""
    with rasterio.open(src_path) as src:
        W = src.width
        H = src.height
        t = src.transform
        bounds = src.bounds
    return {
        "width":  W,
        "height": H,
        "ulx": bounds.left,
        "uly": bounds.top,
        "lrx": bounds.right,
        "lry": bounds.bottom,
        "pixel_size_x": abs(t.a),
        "pixel_size_y": abs(t.e),
    }
