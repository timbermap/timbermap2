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
        # Non-fatal — job is already in DB with status queued

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
