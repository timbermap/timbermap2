import logging
from osgeo import osr

import db
import geo_utils
import model_loader
import tile_processor
from runners import blob_detection, hough_lines, zonal_grid

log = logging.getLogger(__name__)

# Maps pipeline_type → runner module
RUNNERS = {
    "blob_detection": blob_detection,
    "hough_lines":    hough_lines,
    "zonal_grid":     zonal_grid,
}


async def run_pipeline(job_id: str, model_id: str, image_id: str,
                       vector_id: str | None, params: dict):
    """
    Full ML pipeline orchestrator.
    1. Load model artifacts (cached)
    2. Download image from GCS
    3. Optional: clip to AOI
    4. Phase 1: tile inference → probabilities raster
    5. Phase 2: pipeline-specific post-processing
    6. Register outputs in DB
    """
    db.update_job_status(job_id, "running", "Loading model artifacts...")

    # ── 1. Load model config + artifacts ─────────────────────────────────────
    model     = db.get_model(model_id)
    artifacts = db.get_model_artifacts(model_id)

    if not artifacts:
        raise ValueError(f"No artifacts found for model {model_id}. "
                         "Upload weights, means and stds via superadmin first.")

    inf_cfg   = model.get("inference_config") or {}
    phase2_cfg = model.get("phase2_config") or {}
    pipeline_type = model.get("pipeline_type", "blob_detection")

    tile_size       = int(inf_cfg.get("tile_size", 250))
    model_input_size = int(inf_cfg.get("model_input_size", 256))
    n_bands         = int(inf_cfg.get("n_bands", 3))
    n_output_bands  = int(inf_cfg.get("n_output_bands", 1))

    loaded = model_loader.load_model_artifacts(model_id, artifacts)
    keras_model = loaded["model"]
    means       = loaded["means"]
    stds        = loaded["stds"]

    # ── 2. Download image ─────────────────────────────────────────────────────
    db.update_job_status(job_id, "running", "Downloading image...")
    image_record = db.get_image(image_id)
    image_name   = image_record["filename"].rsplit(".", 1)[0]  # "demo4" from "demo4.tif"
    local_image  = f"/tmp/{job_id}_input.tif"
    # Use COG if original file not available (COG is at users/cogs/{image_id}.tif)
    cog_path = f"users/cogs/{image_id}.tif"
    source_path = cog_path  # COG is the processed, cloud-optimized version
    geo_utils.download_from_gcs(source_path, local_image)

    # ── 3. Optional AOI clip ──────────────────────────────────────────────────
    aoi_shp = None

    # Priority: inline GeoJSON > vector_id from DB
    aoi_geojson = (params or {}).get("aoi_geojson")

    if aoi_geojson:
        import json as _json
        db.update_job_status(job_id, "running", "Applying AOI clip (GeoJSON)...")
        geojson_path = f"/tmp/{job_id}_aoi.geojson"
        geojson_data = aoi_geojson if isinstance(aoi_geojson, dict) else _json.loads(aoi_geojson)
        with open(geojson_path, "w") as _f:
            _json.dump(geojson_data, _f)
        aoi_shp = geo_utils.geojson_to_shp(geojson_path, job_id)
        local_image = geo_utils.clip_raster_to_vector(local_image, aoi_shp, job_id)
        log.info("Clipped image to inline GeoJSON AOI: %s", local_image)

    elif vector_id:
        db.update_job_status(job_id, "running", "Applying AOI clip...")
        vector_record = db.get_vector(vector_id)
        aoi_shp = geo_utils.extract_vector_to_shp(vector_record["gcs_path"], job_id)
        local_image = geo_utils.clip_raster_to_vector(local_image, aoi_shp, job_id)
        log.info("Clipped image to vector AOI: %s", local_image)

    # ── 4. Phase 1: tile inference ────────────────────────────────────────────
    db.update_job_status(job_id, "running", "Running model inference...")

    def progress_cb(done, total):
        pct = int(done / total * 100)
        log.info("Inference progress: %d/%d tiles (%d%%)", done, total, pct)
        db.update_job_status(job_id, "running", f"Inference {pct}% complete...")

    prob_raster = tile_processor.run_tile_inference(
        src_path        = local_image,
        model           = keras_model,
        means           = means,
        stds            = stds,
        tile_size       = tile_size,
        model_input_size = model_input_size,
        n_bands         = n_bands,
        n_output_bands  = n_output_bands,
        job_id          = job_id,
        progress_callback = progress_cb,
    )

    # ── 5. Get geo info for runners ───────────────────────────────────────────
    epsg     = tile_processor.get_epsg(local_image)
    geo_info = tile_processor.get_geotransform_info(local_image)

    # ── 6. Phase 2: pipeline-specific post-processing ─────────────────────────
    runner = RUNNERS.get(pipeline_type)
    if not runner:
        raise ValueError(f"Unknown pipeline_type: {pipeline_type}")

    db.update_job_status(job_id, "running", f"Post-processing ({pipeline_type})...")

    # Merge user params into phase2_cfg (user can override blob detector params, etc.)
    # Strip internal params before passing to runner
    _user_params  = {k: v for k, v in (params or {}).items() if k != "aoi_geojson"}
    effective_cfg = {**phase2_cfg, **_user_params}

    import inspect as _inspect
    _runner_params = _inspect.signature(runner.run).parameters
    _run_kwargs = dict(
        job_id      = job_id,
        prob_raster = prob_raster,
        cfg         = effective_cfg,
        aoi_shp     = aoi_shp,
        epsg        = epsg,
        geo_info    = geo_info,
    )
    if "image_name" in _runner_params:
        _run_kwargs["image_name"] = image_name

    _, summary = runner.run(**_run_kwargs)

    # ── 7. Finalize ───────────────────────────────────────────────────────────
    db.update_job_summary(job_id, summary)
    log.info("Pipeline complete — job=%s summary=%s", job_id, summary)
