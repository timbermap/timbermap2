import os
import json
from google.cloud import tasks_v2
from dotenv import load_dotenv

load_dotenv()

def enqueue_raster_ingest(job_id: str, image_id: str, gcs_path: str, filename: str):
    try:
        client = tasks_v2.CloudTasksClient()
        project = os.getenv("GCP_PROJECT", "timbermap-prod")
        region = "us-central1"
        queue = "raster-ingest"
        worker_url = os.getenv("RASTER_WORKER_URL", "http://localhost:8001")

        parent = client.queue_path(project, region, queue)

        payload = json.dumps({
            "job_id": job_id,
            "image_id": image_id,
            "gcs_path": gcs_path,
            "filename": filename,
        }).encode()

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/ingest",
                "body": payload,
                "headers": {"Content-Type": "application/json"},
            }
        }

        client.create_task(parent=parent, task=task)
        print(f"Enqueued raster ingest job {job_id}")
    except Exception as e:
        print(f"Failed to enqueue task: {e}")

def enqueue_vector_ingest(job_id: str, vector_id: str, gcs_path: str, filename: str):
    try:
        client = tasks_v2.CloudTasksClient()
        project = os.getenv("GCP_PROJECT", "timbermap-prod")
        region = "us-central1"
        queue = "vector-ingest"
        worker_url = os.getenv("VECTOR_WORKER_URL", "http://localhost:8002")

        parent = client.queue_path(project, region, queue)

        payload = json.dumps({
            "job_id": job_id,
            "vector_id": vector_id,
            "gcs_path": gcs_path,
            "filename": filename,
        }).encode()

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/ingest",
                "body": payload,
                "headers": {"Content-Type": "application/json"},
            }
        }

        client.create_task(parent=parent, task=task)
        print(f"Enqueued vector ingest job {job_id}")
    except Exception as e:
        print(f"Failed to enqueue task: {e}")


def enqueue_raster_transform(job_id: str, image_id: str, target_epsg: str, target_resolution_m: float = None):
    try:
        client = tasks_v2.CloudTasksClient()
        project = os.getenv("GCP_PROJECT", "timbermap-prod")
        region = "us-central1"
        queue = "raster-ingest"
        worker_url = os.getenv("RASTER_WORKER_URL", "http://localhost:8001")

        parent = client.queue_path(project, region, queue)

        payload = json.dumps({
            "job_id": job_id,
            "image_id": image_id,
            "target_epsg": target_epsg,
            "target_resolution_m": target_resolution_m,
        }).encode()

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/transform",
                "body": payload,
                "headers": {"Content-Type": "application/json"},
            }
        }

        client.create_task(parent=parent, task=task)
        print(f"Enqueued raster transform job {job_id}")
    except Exception as e:
        print(f"Failed to enqueue raster transform: {e}")


def enqueue_vector_transform(job_id: str, vector_id: str, target_epsg: str):
    try:
        client = tasks_v2.CloudTasksClient()
        project = os.getenv("GCP_PROJECT", "timbermap-prod")
        region = "us-central1"
        queue = "vector-ingest"
        worker_url = os.getenv("VECTOR_WORKER_URL", "http://localhost:8002")

        parent = client.queue_path(project, region, queue)

        payload = json.dumps({
            "job_id": job_id,
            "vector_id": vector_id,
            "target_epsg": target_epsg,
        }).encode()

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/transform",
                "body": payload,
                "headers": {"Content-Type": "application/json"},
            }
        }

        client.create_task(parent=parent, task=task)
        print(f"Enqueued vector transform job {job_id}")
    except Exception as e:
        print(f"Failed to enqueue vector transform: {e}")


def enqueue_ml_job(job_id: str, model_id: str, image_id: str,
                   vector_id: str | None, params: dict):
    """
    Enqueues an ML inference job to the ml-inference Cloud Tasks queue.
    The ML Worker Cloud Run service picks it up and runs the appropriate pipeline.
    """
    try:
        client = tasks_v2.CloudTasksClient()
        project    = os.getenv("GCP_PROJECT", "timbermap-prod")
        region     = "us-central1"
        queue      = "ml-inference"
        worker_url = os.getenv("ML_WORKER_URL", "http://localhost:8003")

        parent = client.queue_path(project, region, queue)

        payload = json.dumps({
            "job_id":    job_id,
            "model_id":  model_id,
            "image_id":  image_id,
            "vector_id": vector_id,
            "params":    params or {},
        }).encode()

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/run",
                "body": payload,
                "headers": {"Content-Type": "application/json"},
                "oidc_token": {
                    "service_account_email": "timbermap-api@timbermap-prod.iam.gserviceaccount.com",
                    "audience": worker_url,
                },
            },
            "dispatch_deadline": {"seconds": 1800},
        }

        client.create_task(parent=parent, task=task)
        print(f"Enqueued ML job {job_id} model={model_id}")
    except Exception as e:
        print(f"Failed to enqueue ML job: {e}")
        # Non-fatal — job is already in DB with status queued


def enqueue_raster_analysis(job_id: str, model_id: str, image_id: str, params: dict):
    """
    Enqueues a raster analysis job (e.g. gap_detection) to the raster worker.
    Uses the same raster-ingest queue but hits /analyze/gaps endpoint.
    """
    try:
        client = tasks_v2.CloudTasksClient()
        project    = os.getenv("GCP_PROJECT", "timbermap-prod")
        region     = "us-central1"
        queue      = "raster-ingest"
        worker_url = os.getenv("RASTER_WORKER_URL", "http://localhost:8001")

        parent = client.queue_path(project, region, queue)

        payload = json.dumps({
            "job_id":   job_id,
            "image_id": image_id,
            "params":   params or {},
        }).encode()

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/analyze/gaps",
                "body": payload,
                "headers": {"Content-Type": "application/json"},
            },
            "dispatch_deadline": {"seconds": 1800},
        }

        client.create_task(parent=parent, task=task)
        print(f"Enqueued raster analysis job {job_id} model={model_id}")
    except Exception as e:
        print(f"Failed to enqueue raster analysis job: {e}")

