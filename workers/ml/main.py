import os
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

from pipeline import run_pipeline
from db import update_job_status

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="Timbermap ML Worker", version="1.0.0")


class RunRequest(BaseModel):
    job_id: str
    model_id: str
    image_id: str
    vector_id: Optional[str] = None
    params: Optional[dict] = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "timbermap-ml-worker"}


@app.post("/run")
async def run(req: RunRequest):
    """
    Called by Cloud Tasks. Runs the full ML pipeline for a job.
    Always returns 200 — errors are written to the job record in DB.
    Cloud Tasks retries on non-2xx, so we catch everything here.
    """
    log.info("Starting job %s model=%s image=%s", req.job_id, req.model_id, req.image_id)
    try:
        await run_pipeline(
            job_id=req.job_id,
            model_id=req.model_id,
            image_id=req.image_id,
            vector_id=req.vector_id,
            params=req.params or {},
        )
        log.info("Job %s completed successfully", req.job_id)
        return {"status": "done", "job_id": req.job_id}
    except Exception as e:
        log.error("Job %s failed: %s", req.job_id, e, exc_info=True)
        try:
            update_job_status(req.job_id, "failed", str(e))
        except Exception as db_err:
            log.error("Failed to update job status: %s", db_err)
        # Return 200 so Cloud Tasks doesn't retry — the error is in the DB
        return {"status": "failed", "job_id": req.job_id, "error": str(e)}
