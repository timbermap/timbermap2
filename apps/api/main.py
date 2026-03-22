import os
import json
import requests as http_requests
from datetime import timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import storage
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from webhooks import router as webhook_router
from stats import router as stats_router
from database import (
    ensure_user, get_user_id,
    insert_image, insert_vector,
    get_images, get_vectors, get_jobs,
    insert_job
)
from tasks import enqueue_raster_ingest, enqueue_vector_ingest, enqueue_raster_transform, enqueue_vector_transform

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

CLEANUP_WORKER_URL = os.getenv("CLEANUP_WORKER_URL", "https://timbermap-cleanup-worker-788407107542.us-central1.run.app")

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

@app.get("/health")
def health():
    return {"status": "ok", "service": "timbermap-api"}

@app.post("/upload/signed-url")
def get_signed_url(req: SignedUrlRequest):
    try:
        ensure_user(req.clerk_id, req.email, req.username)
        client = storage.Client()
        bucket = client.bucket(os.getenv("GCS_BUCKET"))
        folder = "rasters" if req.file_type == "raster" else "vectors"
        blob = bucket.blob(f"users/{req.clerk_id}/{folder}/{req.filename}")
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(hours=2),
            method="PUT",
            content_type=req.content_type,
        )
        return {
            "url": url,
            "gcs_path": f"users/{req.clerk_id}/{folder}/{req.filename}"
        }
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
                "image_id": str(file_id),
                "gcs_path": req.gcs_path,
                "filename": req.filename
            })
            enqueue_raster_ingest(str(job_id), str(file_id), req.gcs_path, req.filename)
        else:
            file_id = insert_vector(user_id, req.filename, req.gcs_path, req.filesize)
            job_id = insert_job(user_id, "vector_ingest", {
                "vector_id": str(file_id),
                "gcs_path": req.gcs_path,
                "filename": req.filename
            })
            enqueue_vector_ingest(str(job_id), str(file_id), req.gcs_path, req.filename)

        return {"file_id": str(file_id), "job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

@app.get("/jobs/{clerk_id}")
def list_jobs(clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        return {"jobs": []}
    jobs = get_jobs(user_id)
    for j in jobs:
        for field in ['created_at', 'started_at', 'finished_at']:
            if j.get(field):
                j[field] = j[field].isoformat()
        for field in ['input_ref', 'output_ref']:
            if j.get(field) and isinstance(j[field], str):
                j[field] = json.loads(j[field])
    return {"jobs": jobs}

@app.post("/images/transform")
def transform_image(req: TransformImageRequest):
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")
        job_id = insert_job(user_id, "raster_transform", {
            "image_id": req.image_id,
            "new_epsg": req.new_epsg,
            "new_resolution_x": req.new_resolution_x,
            "new_resolution_y": req.new_resolution_y,
        })
        if req.new_epsg:
            res_m = req.new_resolution_x or req.new_resolution_y or None
            enqueue_raster_transform(str(job_id), req.image_id, req.new_epsg, res_m)
        return {"job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/vectors/transform")
def transform_vector(req: TransformVectorRequest):
    try:
        user_id = get_user_id(req.clerk_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found")
        job_id = insert_job(user_id, "vector_transform", {
            "vector_id": req.vector_id,
            "new_epsg": req.new_epsg,
        })
        enqueue_vector_transform(str(job_id), req.vector_id, req.new_epsg)
        return {"job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/images/{image_id}")
def delete_image(image_id: str, clerk_id: str):
    """Delete a raster image — verifies ownership then calls cleanup worker."""
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    images = get_images(user_id)
    if not any(str(i["id"]) == image_id for i in images):
        raise HTTPException(status_code=403, detail="Not authorized or not found")
    try:
        r = http_requests.delete(
            f"{CLEANUP_WORKER_URL}/raster/{image_id}",
            timeout=60,
        )
        r.raise_for_status()
        return {"deleted": "image", "image_id": image_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/vectors/{vector_id}")
def delete_vector(vector_id: str, clerk_id: str):
    """Delete a vector — verifies ownership then calls cleanup worker."""
    user_id = get_user_id(clerk_id)
    if not user_id:
        raise HTTPException(status_code=404, detail="User not found")
    vectors = get_vectors(user_id)
    if not any(str(v["id"]) == vector_id for v in vectors):
        raise HTTPException(status_code=403, detail="Not authorized or not found")
    try:
        r = http_requests.delete(
            f"{CLEANUP_WORKER_URL}/vector/{vector_id}",
            timeout=60,
        )
        r.raise_for_status()
        return {"deleted": "vector", "vector_id": vector_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/layers/{clerk_id}")
def get_layers(clerk_id: str):
    user_id = get_user_id(clerk_id)
    if not user_id:
        return {"layers": []}

    geoserver_url = os.getenv(
        "GEOSERVER_URL",
        "https://timbermap-geoserver-788407107542.us-central1.run.app/geoserver"
    )
    workspace = "timbermap"
    images = get_images(user_id)
    vectors = get_vectors(user_id)
    layers = []

    for img in images:
        if img.get("status") == "ready" and img.get("geoserver_layer"):
            layers.append({
                "id": img["id"],
                "name": img["filename"],
                "type": "raster",
                "layer": img["geoserver_layer"],
                "wms_url": f"{geoserver_url}/{workspace}/wms",
                "epsg": img.get("epsg"),
            })

    for vec in vectors:
        if vec.get("status") == "ready" and vec.get("geoserver_layer"):
            layers.append({
                "id": vec["id"],
                "name": vec["filename"],
                "type": "vector",
                "layer": vec["geoserver_layer"],
                "wms_url": f"{geoserver_url}/{workspace}/wms",
                "epsg": vec.get("epsg"),
            })

    return {"layers": layers}

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
        bucket = client.bucket(os.getenv("GCS_BUCKET"))
        blob = bucket.blob(img["gcs_path"])
        url = blob.generate_signed_url(version="v4", expiration=timedelta(hours=1), method="GET")
        return {"url": url}
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
        bucket = client.bucket(os.getenv("GCS_BUCKET"))
        blob = bucket.blob(vec["gcs_path"])
        url = blob.generate_signed_url(version="v4", expiration=timedelta(hours=1), method="GET")
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
