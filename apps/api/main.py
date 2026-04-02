import os
import json
import requests as http_requests
from datetime import timedelta
from fastapi import FastAPI, HTTPException, Response, Header
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import storage
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

from webhooks import router as webhook_router
from stats import router as stats_router
from superadmin import router as superadmin_router, models_router

from database import (
    ensure_user, get_user_id, get_conn,
    insert_image, insert_vector,
    get_images, get_vectors, get_jobs,
    insert_job,
    get_model_by_id,
    check_model_permission,
    insert_job_ml,
    get_job_outputs,
    delete_job,
)
from tasks import (
    enqueue_raster_ingest, enqueue_vector_ingest,
    enqueue_raster_transform, enqueue_vector_transform,
    enqueue_ml_job, enqueue_raster_analysis,
)

load_dotenv()

app = FastAPI(title="Timbermap API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://timbermap.com",
        "https://timbermap-web-788407107542.us-central1.run.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router)
app.include_router(stats_router, prefix="/stats", tags=["stats"])
app.include_router(superadmin_router)
app.include_router(models_router)

CLEANUP_WORKER_URL = os.getenv("CLEANUP_WORKER_URL", "https://timbermap-cleanup-worker-788407107542.us-central1.run.app")
GCS_BUCKET = os.getenv("GCS_BUCKET", "timbermap-data")


def get_db_conn():
    import psycopg2
    import psycopg2.extras
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


# ── Pydantic models ───────────────────────────────────────────────────────────

class SignedUrlRequest(BaseModel):
    filename: str
    content_type: str
    clerk_id: str
    email: str
    username: str
    file_type: str = "raster"
    filesize: Optional[int] = 0

class ConfirmUploadRequest(BaseModel):
    clerk_id: str
    filename: str
    gcs_path: str
    filesize: Optional[int] = 0
    file_type: str = "raster"

class TransformImageRequest(BaseModel):
    clerk_id: str
    image_id: str
    new_epsg: Optional[str] = None
    new_resolution_x: Optional[float] = None
    new_resolution_y: Optional[float] = None

class TransformVectorRequest(BaseModel):
    clerk_id: str
    vector_id: str
    new_epsg: str

class AoiRequest(BaseModel):
    clerk_id: str
    name: str
    geojson: dict

class RunModelRequest(BaseModel):
    clerk_id: str
    model_id: str
    image_id: str
    vector_id: Optional[str] = None
    params: Optional[dict] = None


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "timbermap-api"}


# ── Upload ────────────────────────────────────────────────────────────────────

@app.post("/upload/signed-url")
def get_signed_url(req: SignedUrlRequest):
    try:
        ensure_user(req.clerk_id, req.email, req.username)
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        folder = "rasters" if req.file_type == "raster" else "vectors"
        blob = bucket.blob(f"users/{req.clerk_id}/{folder}/{req.filename}")
        url = blob.generate_signed_url(
            version="v4", expiration=timedelta(hours=2),
            method="PUT", content_type=req.content_type,
        )
        return {"url": url, "gcs_path": f"users/{req.clerk_id}/{folder}/{req.filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload/confirm")
def confirm_upload(req: ConfirmUploadRequest):
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")
        if req.file_type == "raster":
            file_id = insert_image(user_id, req.filename, req.gcs_path, req.filesize)
            job_id = insert_job(user_id, "raster_ingest", {
                "image_id": str(file_id), "gcs_path": req.gcs_path, "filename": req.filename
            })
            enqueue_raster_ingest(str(job_id), str(file_id), req.gcs_path, req.filename)
        else:
            file_id = insert_vector(user_id, req.filename, req.gcs_path, req.filesize)
            job_id = insert_job(user_id, "vector_ingest", {
                "vector_id": str(file_id), "gcs_path": req.gcs_path, "filename": req.filename
            })
            enqueue_vector_ingest(str(job_id), str(file_id), req.gcs_path, req.filename)
        return {"file_id": str(file_id), "job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Images ────────────────────────────────────────────────────────────────────

@app.get("/images/{clerk_id}")
def list_images(clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        return {"images": []}
    images = get_images(user_id)
    for img in images:
        if img.get('created_at'):
            img['created_at'] = img['created_at'].isoformat()
    return {"images": images}


@app.post("/images/transform")
def transform_image(req: TransformImageRequest):
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")
        job_id = insert_job(user_id, "raster_transform", {
            "image_id": req.image_id, "new_epsg": req.new_epsg,
            "new_resolution_x": req.new_resolution_x, "new_resolution_y": req.new_resolution_y,
        })
        if req.new_epsg:
            res_m = req.new_resolution_x or req.new_resolution_y or None
            enqueue_raster_transform(str(job_id), req.image_id, req.new_epsg, res_m)
        return {"job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/images/{image_id}/thumbnail")
def thumbnail_image(image_id: str, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    images = get_images(user_id)
    if not any(str(i["id"]) == image_id for i in images):
        raise HTTPException(status_code=403, detail="Not found")
    try:
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(f"users/thumbnails/{image_id}.jpg")
        url = blob.generate_signed_url(version="v4", expiration=timedelta(hours=1), method="GET")
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/images/{image_id}")
def delete_image(image_id: str, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    images = get_images(user_id)
    if not any(str(i["id"]) == image_id for i in images):
        raise HTTPException(status_code=403, detail="Not authorized or not found")
    try:
        r = http_requests.delete(f"{CLEANUP_WORKER_URL}/raster/{image_id}", timeout=60)
        r.raise_for_status()
        return {"deleted": "image", "image_id": image_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/images/{image_id}/download")
def download_image(image_id: str, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    images = get_images(user_id)
    img = next((i for i in images if str(i["id"]) == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(img["gcs_path"])
        url = blob.generate_signed_url(version="v4", expiration=timedelta(hours=1), method="GET")
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Vectors ───────────────────────────────────────────────────────────────────

@app.get("/vectors/{clerk_id}")
def list_vectors(clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        return {"vectors": []}
    vectors = get_vectors(user_id)
    for v in vectors:
        if v.get('created_at'):
            v['created_at'] = v['created_at'].isoformat()
    return {"vectors": vectors}


@app.post("/vectors/transform")
def transform_vector(req: TransformVectorRequest):
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")
        job_id = insert_job(user_id, "vector_transform", {
            "vector_id": req.vector_id, "new_epsg": req.new_epsg,
        })
        enqueue_vector_transform(str(job_id), req.vector_id, req.new_epsg)
        return {"job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/vectors/{vector_id}")
def delete_vector(vector_id: str, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    vectors = get_vectors(user_id)
    if not any(str(v["id"]) == vector_id for v in vectors):
        raise HTTPException(status_code=403, detail="Not authorized or not found")
    try:
        r = http_requests.delete(f"{CLEANUP_WORKER_URL}/vector/{vector_id}", timeout=60)
        r.raise_for_status()
        return {"deleted": "vector", "vector_id": vector_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vectors/{vector_id}/download")
def download_vector(vector_id: str, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    vectors = get_vectors(user_id)
    vec = next((v for v in vectors if str(v["id"]) == vector_id), None)
    if not vec:
        raise HTTPException(status_code=404, detail="Vector not found")
    try:
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(vec["gcs_path"])
        url = blob.generate_signed_url(version="v4", expiration=timedelta(hours=1), method="GET")
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vectors/{vector_id}/preview")
def preview_vector(vector_id: str, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    vectors = get_vectors(user_id)
    if not any(str(v["id"]) == vector_id for v in vectors):
        raise HTTPException(status_code=403, detail="Not found")
    table = f"vec_{vector_id.replace('-', '_')}"
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(f"""
            SELECT
                ST_AsSVG(ST_Transform(ST_Collect(geometry), 4326), 0, 4) AS path,
                ST_XMin(ST_Extent(ST_Transform(geometry, 4326))) AS minx,
                ST_YMin(ST_Extent(ST_Transform(geometry, 4326))) AS miny,
                ST_XMax(ST_Extent(ST_Transform(geometry, 4326))) AS maxx,
                ST_YMax(ST_Extent(ST_Transform(geometry, 4326))) AS maxy
            FROM vectors."{table}"
        """)
        row = cur.fetchone()
    finally:
        cur.close(); conn.close()
    if not row or not row["path"]:
        raise HTTPException(status_code=404, detail="No geometry")
    minx, miny, maxx, maxy = float(row["minx"]), float(row["miny"]), float(row["maxx"]), float(row["maxy"])
    w, h = maxx - minx, maxy - miny
    pad = max(w, h) * 0.08
    vb = f"{minx - pad} {-maxy - pad} {w + 2*pad} {h + 2*pad}"
    sw = max(w, h) * 0.008
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">'
        f'<path d="{row["path"]}" fill="#6AA8A0" fill-opacity="0.35" stroke="#3D7A72" stroke-width="{sw}" stroke-linejoin="round"/>'
        f'</svg>'
    )
    return Response(
        content=svg, media_type="image/svg+xml",
        headers={"X-Bbox": f"{minx},{miny},{maxx},{maxy}", "Access-Control-Expose-Headers": "X-Bbox"},
    )


@app.post("/vectors/from-aoi")
def create_vector_from_aoi(req: AoiRequest):
    import json as json_lib
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")

        name     = req.name.strip() or "AOI"
        filename = f"{name}.geojson"
        gcs_path = f"aoi/{req.clerk_id}/{name}.geojson"

        file_id = insert_vector(user_id, filename, gcs_path, 0)
        table   = f"vec_{str(file_id).replace('-', '_')}"
        geojson_str = json_lib.dumps(req.geojson)

        conn = get_db_conn()
        cur  = conn.cursor()

        cur.execute('CREATE SCHEMA IF NOT EXISTS "vectors"')
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS "vectors"."{table}" (
                id SERIAL PRIMARY KEY,
                name TEXT,
                geometry geometry(Geometry, 4326)
            )
        """)
        cur.execute(f"""
            INSERT INTO "vectors"."{table}" (name, geometry)
            VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        """, (name, geojson_str))

        cur.execute("SELECT ST_Area(ST_Transform(ST_GeomFromGeoJSON(%s), 3857)) / 10000 AS area_ha", (geojson_str,))
        area_ha = round(cur.fetchone()["area_ha"], 2)

        cur.execute("""
            UPDATE vectors SET status = 'ready', epsg = '4326',
            geometry_type = 'Polygon', area_ha = %s WHERE id = %s
        """, (area_ha, file_id))

        conn.commit()
        cur.close()
        conn.close()

        # Upload GeoJSON to GCS so ML worker can download it as AOI
        try:
            import io
            client = storage.Client()
            blob = client.bucket(GCS_BUCKET).blob(gcs_path)
            feature = {"type": "Feature", "geometry": req.geojson, "properties": {"name": name}}
            geojson_fc = json_lib.dumps({"type": "FeatureCollection", "features": [feature]})
            blob.upload_from_string(geojson_fc, content_type="application/json")
        except Exception as e:
            print(f"Warning: could not upload AOI to GCS: {e}")

        return {"vector_id": str(file_id), "name": filename, "area_ha": area_ha}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vectors/{vector_id}/tiles/{z}/{x}/{y}")
def vector_tiles(vector_id: str, z: int, x: int, y: int, clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    vectors = get_vectors(user_id)
    vec = next((v for v in vectors if str(v["id"]) == vector_id), None)
    if not vec:
        raise HTTPException(status_code=403, detail="Not authorized or not found")

    table = f"vec_{vector_id.replace('-', '_')}"

    try:
        conn = get_db_conn()
        cur  = conn.cursor()
        cur.execute(f"""
            SELECT ST_AsMVT(tile, 'layer', 4096, 'geom') AS mvt
            FROM (
                SELECT
                    ST_AsMVTGeom(
                        ST_Transform(geometry, 3857),
                        ST_TileEnvelope(%s, %s, %s),
                        4096, 64, true
                    ) AS geom,
                    *
                FROM "vectors"."{table}"
                WHERE geometry IS NOT NULL
                  AND ST_Intersects(
                      ST_Transform(geometry, 3857),
                      ST_TileEnvelope(%s, %s, %s)
                  )
            ) tile
            WHERE geom IS NOT NULL
        """, (z, x, y, z, x, y))
        row = cur.fetchone()
        cur.close()
        conn.close()

        mvt_data = bytes(row["mvt"]) if row and row["mvt"] else b""
        return Response(
            content=mvt_data,
            media_type="application/x-protobuf",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600",
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Jobs ──────────────────────────────────────────────────────────────────────

@app.get("/jobs/{clerk_id}")
def list_jobs(clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        return {"jobs": []}
    conn = get_db_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            j.id, j.type, j.status, j.message,
            j.input_ref, j.output_ref,
            j.model_id, j.input_image_id, j.input_vector_id,
            j.input_params, j.summary,
            j.started_at, j.finished_at, j.created_at,
            m.name  AS model_name,
            i.filename AS image_filename,
            v.filename AS vector_filename
        FROM jobs j
        LEFT JOIN models m  ON m.id  = j.model_id
        LEFT JOIN images i  ON i.id  = j.input_image_id
        LEFT JOIN vectors v ON v.id  = j.input_vector_id
        WHERE j.owner_id = %s
        ORDER BY j.created_at DESC
        LIMIT 200
    """, (str(user_id),))
    rows = cur.fetchall()
    cur.close(); conn.close()
    jobs = []
    for j in rows:
        d = dict(j)
        for field in ['created_at', 'started_at', 'finished_at']:
            if d.get(field):
                d[field] = d[field].isoformat()
        for field in ['input_ref', 'output_ref', 'input_params', 'summary']:
            if d.get(field) and isinstance(d[field], str):
                try: d[field] = json.loads(d[field])
                except: pass
        jobs.append(d)
    return {"jobs": jobs}




@app.delete("/jobs/{job_id}")
def remove_job(job_id: str, clerk_id: str):
    """Deletes a job, its DB outputs, and GCS files."""
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        gcs_paths = delete_job(job_id, str(user_id))
        # Delete GCS files
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        deleted_files = []
        for path in gcs_paths:
            try:
                bucket.blob(path).delete()
                deleted_files.append(path)
            except Exception:
                pass
        return {"deleted": True, "job_id": job_id, "files_deleted": len(deleted_files)}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/jobs/run-model")
def run_model(req: RunModelRequest):
    """Enqueues an inference job. Routes to raster or ML worker based on model type."""
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")

        model = get_model_by_id(req.model_id)
        if not model:
            raise HTTPException(status_code=404, detail="Model not found or inactive")

        if not check_model_permission(str(user_id), req.model_id):
            raise HTTPException(status_code=403, detail="No permission to run this model")

        job_id = insert_job_ml(
            owner_id=str(user_id),
            model_id=req.model_id,
            image_id=req.image_id,
            vector_id=req.vector_id,
            params=req.params or {},
        )

        model_type = model.get("type", "ml")
        print(f"run_model: model_type={model_type} model_id={req.model_id}")

        if model_type == "raster":
            raster_params = {**(req.params or {})}
            if req.vector_id:
                raster_params["vector_id"] = req.vector_id
            enqueue_raster_analysis(
                job_id=job_id,
                model_id=req.model_id,
                image_id=req.image_id,
                params=raster_params,
            )
        else:
            enqueue_ml_job(
                job_id=job_id,
                model_id=req.model_id,
                image_id=req.image_id,
                vector_id=req.vector_id,
                params=req.params or {},
            )

        return {"job_id": job_id, "status": "queued", "model_id": req.model_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs/{job_id}/outputs")
def list_job_outputs(job_id: str, clerk_id: str):
    """Returns all outputs of an ML job with signed URLs."""
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")

    outputs = get_job_outputs(job_id)
    if not outputs:
        return {"outputs": []}

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)

    result = []
    for out in outputs:
        item = dict(out)
        if item.get('created_at'):
            item['created_at'] = item['created_at'].isoformat()

        try:
            item['download_url'] = bucket.blob(out['gcs_path']).generate_signed_url(
                version="v4", expiration=timedelta(hours=1), method="GET"
            )
        except Exception:
            item['download_url'] = None

        if out.get('is_visualizable'):
            try:
                item['view_url'] = bucket.blob(out['gcs_path']).generate_signed_url(
                    version="v4", expiration=timedelta(days=7), method="GET"
                )
            except Exception:
                item['view_url'] = None

        result.append(item)

    return {"outputs": result}


@app.get("/jobs/{job_id}/outputs/download-all")
def download_all_outputs(job_id: str, clerk_id: str):
    """Returns signed URLs for all outputs. Frontend bundles with JSZip."""
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")

    outputs = get_job_outputs(job_id)
    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)

    files = []
    for out in outputs:
        try:
            url = bucket.blob(out['gcs_path']).generate_signed_url(
                version="v4", expiration=timedelta(hours=1), method="GET"
            )
            files.append({
                "filename": out['gcs_path'].split("/")[-1],
                "label":    out['label'],
                "url":      url,
            })
        except Exception:
            pass

    return {"files": files, "job_id": job_id}


# ── Layers ────────────────────────────────────────────────────────────────────

@app.get("/layers/{clerk_id}")
def get_layers(clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        return {"layers": []}

    images  = get_images(user_id)
    vectors = get_vectors(user_id)
    layers  = []
    client  = storage.Client()
    bucket  = client.bucket(GCS_BUCKET)

    for img in images:
        if img.get("status") == "ready":
            try:
                cog_path = f"users/cogs/{img['id']}.tif"
                blob = bucket.blob(cog_path)
                signed_url = blob.generate_signed_url(
                    version="v4", expiration=timedelta(days=7), method="GET"
                )
                bbox = None
                if all(img.get(k) is not None for k in ["bbox_minx", "bbox_miny", "bbox_maxx", "bbox_maxy"]):
                    bbox = [
                        float(img["bbox_minx"]), float(img["bbox_miny"]),
                        float(img["bbox_maxx"]), float(img["bbox_maxy"]),
                    ]
                layers.append({
                    "id":      img["id"],
                    "name":    img["filename"],
                    "type":    "raster",
                    "cog_url": signed_url,
                    "epsg":    img.get("epsg"),
                    "bbox":    bbox,
                })
            except Exception:
                pass

    api_url = os.getenv("API_PUBLIC_URL", "https://timbermap-api-788407107542.us-central1.run.app")
    for vec in vectors:
        if vec.get("status") == "ready":
            bbox = None
            try:
                table = f"vec_{str(vec['id']).replace('-', '_')}"
                conn = get_db_conn()
                cur = conn.cursor()
                cur.execute(f"""
                    SELECT ST_Extent(ST_Transform(geometry, 4326)) as ext
                    FROM "vectors"."{table}"
                    WHERE geometry IS NOT NULL
                """)
                row = cur.fetchone()
                cur.close(); conn.close()
                if row and row["ext"]:
                    import re
                    nums = re.findall(r"[-0-9.]+", str(row["ext"]))
                    if len(nums) == 4:
                        bbox = [float(nums[0]), float(nums[1]), float(nums[2]), float(nums[3])]
            except Exception:
                pass
            layers.append({
                "id":        vec["id"],
                "name":      vec["filename"],
                "type":      "vector",
                "tiles_url": f"{api_url}/vectors/{vec['id']}/tiles/{{z}}/{{x}}/{{y}}?clerk_id={clerk_id}",
                "epsg":      vec.get("epsg"),
                "bbox":      bbox,
            })

    return {"layers": layers}
# ── Add to apps/api/main.py ───────────────────────────────────────────────────
# These 3 endpoints power the catalog page

from fastapi import Header, Query
import resend  # already used in webhooks

UPGRADE_EMAIL = "sebastian@timbermap.com"
RESEND_API_KEY = os.getenv("RESEND_API_KEY")


@app.get("/catalog/models")
async def get_catalog_models(x_clerk_id: str = Header(None)):
    """All models in DB with whether this user has access and has requested upgrade."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)
    conn = get_db_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            m.id,
            m.name,
            m.description,
            m.pipeline_type,
            COALESCE(m.is_free, false) AS is_free,
            EXISTS(
                SELECT 1 FROM user_model_permissions um
                JOIN users u ON u.id = um.user_id
                WHERE um.model_id = m.id AND u.clerk_id = %s
            ) AS has_access,
            COALESCE((
                SELECT um.is_visible FROM user_model_permissions um
                JOIN users u ON u.id = um.user_id
                WHERE um.model_id = m.id AND u.clerk_id = %s
            ), true) AS is_visible,
            EXISTS(
                SELECT 1 FROM upgrade_requests ur
                JOIN users u ON u.id = ur.user_id
                WHERE ur.model_id = m.id AND u.clerk_id = %s
                AND ur.status = 'pending'
            ) AS upgrade_requested
        FROM models m
        WHERE m.is_active = true
        ORDER BY m.is_free DESC, m.name
    """, (x_clerk_id, x_clerk_id, x_clerk_id))
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [dict(r) for r in rows]


@app.post("/catalog/activate")
async def activate_free_model(
    body: dict,
    x_clerk_id: str = Header(None),
):
    """Grant a free model to the user instantly."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)
    model_id = body.get("model_id")
    conn = get_db_conn()
    cur  = conn.cursor()
    # Verify model is free
    cur.execute("SELECT id FROM models WHERE id = %s AND is_free = true AND is_active = true", (model_id,))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise HTTPException(status_code=400, detail="Model is not free or does not exist")
    # Grant access
    cur.execute("""
        INSERT INTO user_model_permissions (user_id, model_id)
        SELECT u.id, %s FROM users u WHERE u.clerk_id = %s
        ON CONFLICT DO NOTHING
    """, (model_id, x_clerk_id))
    conn.commit()
    cur.close(); conn.close()
    return {"status": "activated"}


@app.post("/catalog/request-upgrade")
async def request_upgrade(
    body: dict,
    x_clerk_id: str = Header(None),
):
    """Log upgrade request in DB and send emails to user + admin."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)

    model_id   = body.get("model_id")
    model_name = body.get("model_name", "")
    message    = body.get("message", "")

    conn = get_db_conn()
    cur  = conn.cursor()

    # Get user info
    cur.execute("""
        SELECT u.id, u.email, u.username FROM users u WHERE u.clerk_id = %s
    """, (x_clerk_id,))
    user = cur.fetchone()
    if not user:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    # Record request in DB
    cur.execute("""
        CREATE TABLE IF NOT EXISTS upgrade_requests (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID REFERENCES users(id),
            model_id   UUID REFERENCES models(id),
            message    TEXT,
            status     TEXT DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cur.execute("""
        INSERT INTO upgrade_requests (user_id, model_id, message)
        VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING
    """, (user["id"], model_id, message))
    conn.commit()
    cur.close(); conn.close()

    # Send email to admin
    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            # Email to admin
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [UPGRADE_EMAIL],
                "subject": f"Upgrade request: {model_name}",
                "html": f"""
                    <h2>New upgrade request</h2>
                    <p><b>User:</b> {user['username']} ({user['email']})</p>
                    <p><b>Model:</b> {model_name}</p>
                    <p><b>Message:</b><br>{message}</p>
                    <p><a href="https://timbermap-web-788407107542.us-central1.run.app/dashboard/admin">
                        Open admin panel →
                    </a></p>
                """
            })
            # Confirmation email to user
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [user["email"]],
                "subject": f"We received your request for {model_name}",
                "html": f"""
                    <h2>Request received</h2>
                    <p>Hi {user['username']},</p>
                    <p>We received your request for access to <b>{model_name}</b>.</p>
                    <p>We'll review it and get back to you within 24 hours.</p>
                    <p>Your message:<br><em>{message}</em></p>
                    <br>
                    <p>— The Timbermap team</p>
                """
            })
        except Exception as e:
            print(f"Email error: {e}")

    return {"status": "requested"}

@app.post("/catalog/toggle-visibility")
async def toggle_model_visibility(
    body: dict,
    x_clerk_id: str = Header(None),
):
    """Show or hide a model from the user models page."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)
    model_id = body.get("model_id")
    visible  = body.get("visible", True)
    conn = get_db_conn()
    cur  = conn.cursor()
    cur.execute("""
        UPDATE user_model_permissions
        SET is_visible = %s
        WHERE model_id = %s
          AND user_id = (SELECT id FROM users WHERE clerk_id = %s)
    """, (visible, model_id, x_clerk_id))
    conn.commit()
    cur.close(); conn.close()
    return {"status": "updated", "visible": visible}


@app.post("/catalog/contact")
async def catalog_contact(
    body: dict,
    x_clerk_id: str = Header(None),
):
    """Send a custom model inquiry email to admin."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)

    message = body.get("message", "")

    conn = get_db_conn()
    cur  = conn.cursor()
    cur.execute("SELECT email, username FROM users WHERE clerk_id = %s", (x_clerk_id,))
    user = cur.fetchone()
    cur.close(); conn.close()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [UPGRADE_EMAIL],
                "subject": "Custom model inquiry",
                "html": f"""
                    <h2>Custom model inquiry</h2>
                    <p><b>From:</b> {user['username']} ({user['email']})</p>
                    <p><b>Message:</b><br>{message}</p>
                """
            })
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [user["email"]],
                "subject": "We received your inquiry",
                "html": f"""
                    <h2>Message received</h2>
                    <p>Hi {user['username']},</p>
                    <p>Thanks for reaching out. We'll get back to you shortly.</p>
                    <p>Your message:<br><em>{message}</em></p>
                    <br>
                    <p>— The Timbermap team</p>
                """
            })
        except Exception as e:
            print(f"Email error: {e}")

    return {"status": "sent"}


# ── Superadmin: Upgrade Requests ──────────────────────────────────────────────

@app.get("/superadmin/upgrade-requests")
async def list_upgrade_requests(x_clerk_id: str = Header(None)):
    """List all upgrade requests (superadmin only)."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)
    conn = get_db_conn()
    cur  = conn.cursor()
    # Check superadmin
    cur.execute("SELECT is_superadmin FROM users WHERE clerk_id = %s", (x_clerk_id,))
    row = cur.fetchone()
    if not row or not row["is_superadmin"]:
        cur.close(); conn.close()
        raise HTTPException(status_code=403)
    cur.execute("""
        SELECT ur.id, ur.status, ur.message, ur.created_at,
               u.email AS user_email, u.username AS user_username,
               m.id AS model_id, m.name AS model_name
        FROM upgrade_requests ur
        JOIN users u ON u.id = ur.user_id
        JOIN models m ON m.id = ur.model_id
        ORDER BY ur.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close(); conn.close()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        result.append(d)
    return {"requests": result}


@app.post("/superadmin/upgrade-requests/{request_id}/approve")
async def approve_upgrade_request(request_id: str, x_clerk_id: str = Header(None)):
    """Approve upgrade request: grant model access + notify user."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)
    conn = get_db_conn()
    cur  = conn.cursor()
    # Check superadmin
    cur.execute("SELECT is_superadmin FROM users WHERE clerk_id = %s", (x_clerk_id,))
    row = cur.fetchone()
    if not row or not row["is_superadmin"]:
        cur.close(); conn.close()
        raise HTTPException(status_code=403)
    # Get request info
    cur.execute("""
        SELECT ur.id, ur.user_id, ur.model_id,
               u.email, u.username, m.name AS model_name
        FROM upgrade_requests ur
        JOIN users u ON u.id = ur.user_id
        JOIN models m ON m.id = ur.model_id
        WHERE ur.id = %s
    """, (request_id,))
    req = cur.fetchone()
    if not req:
        cur.close(); conn.close()
        raise HTTPException(status_code=404)
    # Grant model access
    cur.execute("""
        INSERT INTO user_model_permissions (user_id, model_id)
        VALUES (%s, %s)
        ON CONFLICT DO NOTHING
    """, (req["user_id"], req["model_id"]))
    # Update status
    cur.execute("UPDATE upgrade_requests SET status = 'approved' WHERE id = %s", (request_id,))
    conn.commit()
    cur.close(); conn.close()
    # Send email to user
    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [req["email"]],
                "subject": f"Access granted: {req['model_name']}",
                "html": f"""
                    <h2>Your request was approved!</h2>
                    <p>Hi {req['username']},</p>
                    <p>You now have access to <b>{req['model_name']}</b>.</p>
                    <p>Head to your <a href="https://timbermap-web-788407107542.us-central1.run.app/dashboard/models">models page</a> to start using it.</p>
                    <br>
                    <p>— The Timbermap team</p>
                """
            })
        except Exception as e:
            print(f"Email error: {e}")
    return {"status": "approved"}


@app.post("/superadmin/upgrade-requests/{request_id}/reject")
async def reject_upgrade_request(request_id: str, x_clerk_id: str = Header(None)):
    """Reject upgrade request + notify user."""
    if not x_clerk_id:
        raise HTTPException(status_code=401)
    conn = get_db_conn()
    cur  = conn.cursor()
    # Check superadmin
    cur.execute("SELECT is_superadmin FROM users WHERE clerk_id = %s", (x_clerk_id,))
    row = cur.fetchone()
    if not row or not row["is_superadmin"]:
        cur.close(); conn.close()
        raise HTTPException(status_code=403)
    # Get request info
    cur.execute("""
        SELECT ur.id, u.email, u.username, m.name AS model_name
        FROM upgrade_requests ur
        JOIN users u ON u.id = ur.user_id
        JOIN models m ON m.id = ur.model_id
        WHERE ur.id = %s
    """, (request_id,))
    req = cur.fetchone()
    if not req:
        cur.close(); conn.close()
        raise HTTPException(status_code=404)
    # Update status
    cur.execute("UPDATE upgrade_requests SET status = 'rejected' WHERE id = %s", (request_id,))
    conn.commit()
    cur.close(); conn.close()
    # Send email to user
    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [req["email"]],
                "subject": f"Update on your request: {req['model_name']}",
                "html": f"""
                    <h2>Request update</h2>
                    <p>Hi {req['username']},</p>
                    <p>Unfortunately we're not able to grant access to <b>{req['model_name']}</b> at this time.</p>
                    <p>Feel free to reach out if you have questions or want to discuss your use case.</p>
                    <br>
                    <p>— The Timbermap team</p>
                """
            })
        except Exception as e:
            print(f"Email error: {e}")
    return {"status": "rejected"}
