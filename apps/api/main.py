import os
import json
from datetime import timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import storage
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from webhooks import router as webhook_router
from database import (
    ensure_user, get_user_id,
    insert_image, insert_vector,
    get_images, get_vectors, get_jobs,
    insert_job
)
from tasks import enqueue_raster_ingest, enqueue_vector_ingest

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
            enqueue_raster_ingest(
                str(job_id), str(file_id), req.gcs_path, req.filename
            )
        else:
            file_id = insert_vector(user_id, req.filename, req.gcs_path, req.filesize)
            job_id = insert_job(user_id, "vector_ingest", {
                "vector_id": str(file_id),
                "gcs_path": req.gcs_path,
                "filename": req.filename
            })
            enqueue_vector_ingest(
                str(job_id), str(file_id), req.gcs_path, req.filename
            )

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
        return {"job_id": str(job_id), "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
