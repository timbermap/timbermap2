import os
import uuid
import json
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "timbermap"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor
    )

# ── Users ────────────────────────────────────────────────────────────────────

def ensure_user(clerk_id: str, email: str, username: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO users (clerk_id, email, username)
        VALUES (%s, %s, %s)
        ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email
        RETURNING id
    """, (clerk_id, email, username))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def get_user_id(clerk_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row['id'] if row else None

def get_user_by_clerk_id(clerk_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE clerk_id = %s", (clerk_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return dict(row) if row else None

# ── Images ───────────────────────────────────────────────────────────────────

def insert_image(owner_id, filename, gcs_path, filesize):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO images (owner_id, filename, gcs_path, filesize, status)
        VALUES (%s, %s, %s, %s, 'uploaded')
        RETURNING id
    """, (owner_id, filename, gcs_path, filesize))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def get_images(owner_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, filename, gcs_path, epsg, num_bands,
               area_ha, filesize, status, geoserver_layer, created_at,
               bbox_minx, bbox_miny, bbox_maxx, bbox_maxy,
               pixel_size_x, pixel_size_y
        FROM images WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

# ── Vectors ──────────────────────────────────────────────────────────────────

def insert_vector(owner_id, filename, gcs_path, filesize):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO vectors (owner_id, filename, gcs_path, filesize, status)
        VALUES (%s, %s, %s, %s, 'uploaded')
        RETURNING id
    """, (owner_id, filename, gcs_path, filesize))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def get_vectors(owner_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, filename, gcs_path, epsg, geometry_type,
               area_ha, filesize, status, geoserver_layer, created_at
        FROM vectors WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

# ── Jobs ─────────────────────────────────────────────────────────────────────

def get_jobs(owner_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, type, status, message, input_ref, output_ref,
               model_id, input_image_id, input_vector_id, input_params, summary,
               started_at, finished_at, created_at
        FROM jobs WHERE owner_id = %s
        ORDER BY created_at DESC
    """, (owner_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def insert_job(owner_id, job_type, input_ref):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO jobs (owner_id, type, status, input_ref)
        VALUES (%s, %s, 'queued', %s)
        RETURNING id
    """, (owner_id, job_type, psycopg2.extras.Json(input_ref)))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row['id']

def insert_job_ml(owner_id: str, model_id: str, image_id: str, vector_id: str | None, params: dict):
    conn = get_conn()
    cur = conn.cursor()
    job_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO jobs (id, owner_id, type, status, model_id, input_image_id, input_vector_id, input_params)
        VALUES (%s, %s, 'ml_inference', 'queued', %s, %s, %s, %s)
        RETURNING id
    """, (job_id, owner_id, model_id, image_id, vector_id, json.dumps(params or {})))
    conn.commit()
    cur.close()
    conn.close()
    return job_id

def get_job_outputs(job_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM job_outputs WHERE job_id = %s ORDER BY created_at", (job_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

# ── Models ───────────────────────────────────────────────────────────────────

def get_model_by_id(model_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM models WHERE id = %s AND is_active = true", (model_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return dict(row) if row else None

def get_models_for_user(user_id: str):
    """Returns models the user has permission to run."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT m.*
        FROM models m
        JOIN user_model_permissions p ON p.model_id = m.id
        WHERE p.user_id = %s AND m.is_active = true
        ORDER BY m.created_at
    """, (user_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def get_model_artifacts(model_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM model_artifacts WHERE model_id = %s ORDER BY artifact_key
    """, (model_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def check_model_permission(user_id: str, model_id: str) -> bool:
    """Check if user has permission to run a model (uses user_id uuid, not clerk_id)."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM user_model_permissions WHERE user_id = %s AND model_id = %s",
        (user_id, model_id)
    )
    exists = cur.fetchone() is not None
    cur.close()
    conn.close()
    return exists

# ── Superadmin — Users ───────────────────────────────────────────────────────

def superadmin_list_users():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            u.id, u.clerk_id, u.email, u.username, u.is_superadmin, u.created_at,
            COUNT(DISTINCT i.id)   AS image_count,
            COUNT(DISTINCT v.id)   AS vector_count,
            COUNT(DISTINCT j.id)   AS job_count,
            COALESCE(SUM(i.filesize), 0) AS storage_bytes
        FROM users u
        LEFT JOIN images  i ON i.owner_id = u.id
        LEFT JOIN vectors v ON v.owner_id = u.id
        LEFT JOIN jobs    j ON j.owner_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def superadmin_get_user_detail(clerk_id: str):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT * FROM users WHERE clerk_id = %s", (clerk_id,))
    user = cur.fetchone()
    if not user:
        cur.close(); conn.close()
        return None
    user = dict(user)

    owner_id = user['id']

    # Stats
    cur.execute("""
        SELECT
            COUNT(DISTINCT i.id) AS image_count,
            COUNT(DISTINCT v.id) AS vector_count,
            COUNT(DISTINCT j.id) AS job_count,
            COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'done')    AS jobs_done,
            COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'failed')  AS jobs_failed,
            COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'running') AS jobs_running,
            COALESCE(SUM(i.filesize), 0) AS storage_bytes
        FROM users u
        LEFT JOIN images  i ON i.owner_id = u.id
        LEFT JOIN vectors v ON v.owner_id = u.id
        LEFT JOIN jobs    j ON j.owner_id = u.id
        WHERE u.id = %s
    """, (owner_id,))
    user['stats'] = dict(cur.fetchone())

    # Recent jobs
    cur.execute("""
        SELECT j.id, j.type, j.status, j.message, j.created_at, j.finished_at,
               m.name AS model_name
        FROM jobs j
        LEFT JOIN models m ON m.id = j.model_id
        WHERE j.owner_id = %s
        ORDER BY j.created_at DESC
        LIMIT 10
    """, (owner_id,))
    user['recent_jobs'] = [dict(r) for r in cur.fetchall()]

    # Assigned models
    cur.execute("""
        SELECT m.id, m.name, m.slug, m.pipeline_type, m.is_active,
               p.granted_at, p.granted_by, p.config_override, p.max_runs_month
        FROM models m
        JOIN user_model_permissions p ON p.model_id = m.id
        WHERE p.user_id = %s
        ORDER BY p.granted_at DESC
    """, (owner_id,))
    user['models'] = [dict(r) for r in cur.fetchall()]

    cur.close(); conn.close()
    return user

# ── Superadmin — Models ──────────────────────────────────────────────────────

def superadmin_list_models():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            m.*,
            COUNT(DISTINCT p.user_id)  AS user_count,
            COUNT(DISTINCT j.id)       AS job_count,
            COUNT(DISTINCT a.id)       AS artifact_count
        FROM models m
        LEFT JOIN user_model_permissions p ON p.model_id = m.id
        LEFT JOIN jobs j   ON j.model_id = m.id
        LEFT JOIN model_artifacts a ON a.model_id = m.id
        GROUP BY m.id
        ORDER BY m.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def superadmin_create_model(data: dict):
    conn = get_conn()
    cur = conn.cursor()
    model_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO models (
            id, name, type, slug, description, pipeline_type, worker_type,
            version, is_active, active, inference_config, phase2_config, output_types
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
    """, (
        model_id,
        data['name'],
        data.get('type', 'ml'),
        data['slug'],
        data.get('description', ''),
        data['pipeline_type'],
        data.get('worker_type', 'ml'),
        data.get('version', '1.0'),
        True,
        True,
        json.dumps(data.get('inference_config') or {}),
        json.dumps(data.get('phase2_config') or {}),
        json.dumps(data.get('output_types') or []),
    ))
    row = dict(cur.fetchone())
    conn.commit()
    cur.close()
    conn.close()
    return row

def superadmin_update_model(model_id: str, data: dict):
    conn = get_conn()
    cur = conn.cursor()
    fields = []
    values = []
    allowed = ['name', 'description', 'version', 'pipeline_type',
               'inference_config', 'phase2_config', 'output_types', 'is_active', 'active']
    for key in allowed:
        if key in data:
            fields.append(f"{key} = %s")
            val = data[key]
            if key in ('inference_config', 'phase2_config', 'output_types') and isinstance(val, dict):
                val = json.dumps(val)
            values.append(val)
    if not fields:
        cur.close(); conn.close()
        return None
    values.append(model_id)
    cur.execute(f"UPDATE models SET {', '.join(fields)} WHERE id = %s RETURNING *", values)
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return dict(row) if row else None

def superadmin_deactivate_model(model_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "UPDATE models SET is_active = false, active = false WHERE id = %s RETURNING id",
        (model_id,)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row is not None

# ── Superadmin — Artifacts ───────────────────────────────────────────────────

def superadmin_upsert_artifact(model_id: str, artifact_key: str, gcs_path: str,
                                file_size: int, checksum: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO model_artifacts (model_id, artifact_key, gcs_path, file_size_bytes, checksum)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (model_id, artifact_key)
        DO UPDATE SET
            gcs_path        = EXCLUDED.gcs_path,
            file_size_bytes = EXCLUDED.file_size_bytes,
            checksum        = EXCLUDED.checksum,
            uploaded_at     = now()
        RETURNING *
    """, (model_id, artifact_key, gcs_path, file_size, checksum))
    row = dict(cur.fetchone())
    conn.commit()
    cur.close()
    conn.close()
    return row

# ── Superadmin — Permissions ─────────────────────────────────────────────────

def superadmin_grant_model(user_id: str, model_id: str, granted_by_clerk_id: str,
                            config_override: dict = None, max_runs_month: int = None):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO user_model_permissions
            (user_id, model_id, granted_by, config_override, max_runs_month)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (user_id, model_id) DO UPDATE SET
            granted_by      = EXCLUDED.granted_by,
            granted_at      = now(),
            config_override = COALESCE(EXCLUDED.config_override, user_model_permissions.config_override),
            max_runs_month  = COALESCE(EXCLUDED.max_runs_month,  user_model_permissions.max_runs_month)
    """, (user_id, model_id, granted_by_clerk_id,
          json.dumps(config_override) if config_override else None,
          max_runs_month))
    conn.commit()
    cur.close()
    conn.close()

def superadmin_revoke_model(user_id: str, model_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM user_model_permissions WHERE user_id = %s AND model_id = %s",
        (user_id, model_id)
    )
    deleted = cur.rowcount > 0
    conn.commit()
    cur.close()
    conn.close()
    return deleted

# ── Superadmin — Stats ───────────────────────────────────────────────────────

def superadmin_global_stats():
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS n FROM users")
    total_users = cur.fetchone()['n']

    cur.execute("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'queued')  AS queued,
            COUNT(*) FILTER (WHERE status = 'running') AS running,
            COUNT(*) FILTER (WHERE status = 'done')    AS done,
            COUNT(*) FILTER (WHERE status = 'failed')  AS failed
        FROM jobs
    """)
    jobs = dict(cur.fetchone())

    cur.execute("SELECT COALESCE(SUM(filesize), 0) AS n FROM images")
    storage_bytes = cur.fetchone()['n']

    # Jobs per model (last 30 days)
    cur.execute("""
        SELECT m.name, m.slug, COUNT(j.id) AS job_count
        FROM jobs j
        JOIN models m ON m.id = j.model_id
        WHERE j.created_at > now() - interval '30 days'
        GROUP BY m.id
        ORDER BY job_count DESC
    """)
    jobs_by_model = [dict(r) for r in cur.fetchall()]

    # Recent failures
    cur.execute("""
        SELECT j.id, j.status, j.message, j.created_at,
               u.email, m.name AS model_name
        FROM jobs j
        JOIN users u ON u.id = j.owner_id
        LEFT JOIN models m ON m.id = j.model_id
        WHERE j.status = 'failed'
          AND j.created_at > now() - interval '24 hours'
        ORDER BY j.created_at DESC
        LIMIT 10
    """)
    recent_failures = [dict(r) for r in cur.fetchall()]

    cur.close()
    conn.close()
    return {
        'total_users':     total_users,
        'jobs':            jobs,
        'storage_bytes':   storage_bytes,
        'jobs_by_model':   jobs_by_model,
        'recent_failures': recent_failures,
    }

def superadmin_list_queue():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT j.id, j.type, j.status, j.created_at, j.started_at,
               u.email, u.clerk_id,
               m.name AS model_name, m.pipeline_type,
               i.filename AS image_filename
        FROM jobs j
        JOIN users u ON u.id = j.owner_id
        LEFT JOIN models m ON m.id = j.model_id
        LEFT JOIN images i ON i.id = j.input_image_id
        WHERE j.status IN ('queued', 'running')
        ORDER BY j.created_at ASC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def superadmin_cancel_job(job_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE jobs SET status = 'failed', message = 'Cancelled by superadmin',
        finished_at = now()
        WHERE id = %s AND status IN ('queued', 'running')
        RETURNING id
    """, (job_id,))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row is not None

def superadmin_delete_image(image_id: str):
    """Returns gcs_path so the caller can also delete from GCS."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT gcs_path FROM images WHERE id = %s", (image_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return None
    gcs_path = row['gcs_path']
    cur.execute("DELETE FROM images WHERE id = %s", (image_id,))
    conn.commit()
    cur.close()
    conn.close()
    return gcs_path

def superadmin_delete_job_output(output_id: str):
    """Returns gcs_path so the caller can also delete from GCS."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT gcs_path FROM job_outputs WHERE id = %s", (output_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return None
    gcs_path = row['gcs_path']
    cur.execute("DELETE FROM job_outputs WHERE id = %s", (output_id,))
    conn.commit()
    cur.close()
    conn.close()
    return gcs_path


def delete_job(job_id: str, owner_id: str) -> list:
    """Deletes a job owned by owner_id. Returns list of gcs_paths for cleanup."""
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("SELECT id FROM jobs WHERE id=%s AND owner_id=%s", (job_id, owner_id))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise ValueError("Job not found or not authorized")
    cur.execute("SELECT gcs_path FROM job_outputs WHERE job_id=%s", (job_id,))
    paths = [r["gcs_path"] for r in cur.fetchall()]
    cur.execute("DELETE FROM job_outputs WHERE job_id=%s", (job_id,))
    cur.execute("DELETE FROM jobs WHERE id=%s", (job_id,))
    conn.commit(); cur.close(); conn.close()
    return paths
