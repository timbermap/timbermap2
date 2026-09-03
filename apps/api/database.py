import os
import uuid
import json
import psycopg2
import psycopg2.extras
import psycopg2.pool
from dotenv import load_dotenv

load_dotenv()

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=20,
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT", 5432)),
            dbname=os.getenv("DB_NAME", "timbermap"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD"),
        )
    return _pool


class _PooledConn:
    """
    Transparent wrapper around a pooled psycopg2 connection.
    .close() returns the connection to the pool instead of closing it,
    so all existing call-sites (conn = get_conn() … conn.close()) work unchanged.
    __del__ is a safety net so connections are never permanently leaked if a
    caller forgets to call .close() or an exception bypasses it.
    """
    def __init__(self, pool: psycopg2.pool.ThreadedConnectionPool, conn):
        self._pool = pool
        self._conn = conn
        self._returned = False

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        if not self._returned:
            self._returned = True
            # Roll back any open transaction so the connection is clean for reuse
            try:
                self._conn.rollback()
            except Exception:
                pass
            self._pool.putconn(self._conn)

    def __del__(self):
        self.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def get_conn() -> _PooledConn:
    pool = _get_pool()
    conn = pool.getconn()
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return _PooledConn(pool, conn)

# ── Users ────────────────────────────────────────────────────────────────────

def ensure_user(clerk_id: str, email: str, username: str):
    """Upsert, used as a fallback wherever a user might not exist yet (e.g. the
    Clerk webhook hasn't landed). New users need a personal account created
    alongside them — account_id is NOT NULL — same as webhooks.py user.created."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,))
    existing = cur.fetchone()
    if existing:
        cur.execute("UPDATE users SET email = %s WHERE clerk_id = %s RETURNING id", (email, clerk_id))
        row = cur.fetchone()
    else:
        cur.execute("INSERT INTO accounts DEFAULT VALUES RETURNING id")
        account_id = cur.fetchone()["id"]
        cur.execute("""
            INSERT INTO users (clerk_id, email, username, account_id)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (clerk_id, email, username, account_id))
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

def insert_image(owner_id, filename, gcs_path, filesize, image_id=None):
    conn = get_conn()
    cur = conn.cursor()
    if image_id:
        cur.execute("""
            INSERT INTO images (id, owner_id, filename, gcs_path, filesize, status)
            VALUES (%s, %s, %s, %s, %s, 'uploaded')
            RETURNING id
        """, (image_id, owner_id, filename, gcs_path, filesize))
    else:
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
               pixel_size_x, pixel_size_y, has_display_cog
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
    """Each row is still one user, but the usage numbers (storage/counts/
    has_paid_model) are rolled up across the whole account — teammates share
    one quota/tier even though each keeps their own images/vectors/jobs."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            u.id, u.clerk_id, u.email, u.username, u.is_superadmin, u.created_at,
            u.account_id, u.org_role,
            a.plan, a.plan_expires_at, a.clerk_org_id,
            (SELECT COUNT(*) FROM images  i JOIN users u2 ON u2.id = i.owner_id WHERE u2.account_id = u.account_id) AS image_count,
            (SELECT COUNT(*) FROM vectors v JOIN users u2 ON u2.id = v.owner_id WHERE u2.account_id = u.account_id) AS vector_count,
            (SELECT COUNT(*) FROM jobs    j JOIN users u2 ON u2.id = j.owner_id WHERE u2.account_id = u.account_id) AS job_count,
            (
                (SELECT COALESCE(SUM(i.filesize), 0) FROM images  i JOIN users u2 ON u2.id = i.owner_id WHERE u2.account_id = u.account_id) +
                (SELECT COALESCE(SUM(v.filesize), 0) FROM vectors v JOIN users u2 ON u2.id = v.owner_id WHERE u2.account_id = u.account_id) +
                (SELECT COALESCE(SUM(jo.file_size_bytes), 0) FROM job_outputs jo JOIN jobs j ON j.id = jo.job_id JOIN users u2 ON u2.id = j.owner_id WHERE u2.account_id = u.account_id)
            ) AS storage_bytes,
            EXISTS (
                SELECT 1 FROM user_model_permissions p
                JOIN models m ON m.id = p.model_id
                JOIN users u3 ON u3.id = p.user_id
                WHERE u3.account_id = u.account_id AND m.is_free = false
            ) AS has_paid_model
        FROM users u
        JOIN accounts a ON a.id = u.account_id
        ORDER BY u.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def get_tier_limits():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT tier, storage_limit_gb, weekly_job_limit FROM tier_limits ORDER BY tier")
    rows = [dict(r) for r in cur.fetchall()]
    cur.close(); conn.close()
    return rows


def set_tier_limit(tier: str, storage_limit_gb, weekly_job_limit):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE tier_limits SET storage_limit_gb = %s, weekly_job_limit = %s, updated_at = now()
        WHERE tier = %s
        RETURNING tier
    """, (storage_limit_gb, weekly_job_limit, tier))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row is not None


def superadmin_set_plan(clerk_id: str, plan: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE accounts SET plan = %s
        WHERE id = (SELECT account_id FROM users WHERE clerk_id = %s)
        RETURNING id
    """, (plan, clerk_id))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row is not None


def superadmin_set_account_limits(clerk_id: str, storage_limit_gb, weekly_job_limit):
    """Per-account overrides — null means 'fall back to the tier default'."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE accounts SET storage_limit_gb_override = %s, weekly_job_limit_override = %s
        WHERE id = (SELECT account_id FROM users WHERE clerk_id = %s)
        RETURNING id
    """, (storage_limit_gb, weekly_job_limit, clerk_id))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row is not None

def superadmin_set_plan_expiration(clerk_id: str, plan_expires_at):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE accounts SET plan_expires_at = %s
        WHERE id = (SELECT account_id FROM users WHERE clerk_id = %s)
        RETURNING id
    """, (plan_expires_at, clerk_id))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return row is not None

def superadmin_get_user_detail(clerk_id: str):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT u.*, a.plan AS account_plan, a.plan_expires_at, a.clerk_org_id,
               a.storage_limit_gb_override, a.weekly_job_limit_override
        FROM users u JOIN accounts a ON a.id = u.account_id
        WHERE u.clerk_id = %s
    """, (clerk_id,))
    user = cur.fetchone()
    if not user:
        cur.close(); conn.close()
        return None
    user = dict(user)
    user["is_organization"] = user["clerk_org_id"] is not None

    cur.execute("SELECT storage_limit_gb, weekly_job_limit FROM tier_limits WHERE tier = %s", (user["account_plan"],))
    tier_default = cur.fetchone() or {"storage_limit_gb": None, "weekly_job_limit": None}
    user["tier_storage_limit_gb"] = tier_default["storage_limit_gb"]
    user["tier_weekly_job_limit"] = tier_default["weekly_job_limit"]

    owner_id = user['id']
    account_id = user['account_id']

    # This user's own activity (unaffected by teammates)
    cur.execute("""
        SELECT
            (SELECT COUNT(*) FROM images  i WHERE i.owner_id = %(uid)s) AS image_count,
            (SELECT COUNT(*) FROM vectors v WHERE v.owner_id = %(uid)s) AS vector_count,
            (SELECT COUNT(*) FROM jobs    j WHERE j.owner_id = %(uid)s) AS job_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.owner_id = %(uid)s AND j.status = 'done')    AS jobs_done,
            (SELECT COUNT(*) FROM jobs j WHERE j.owner_id = %(uid)s AND j.status = 'failed')  AS jobs_failed,
            (SELECT COUNT(*) FROM jobs j WHERE j.owner_id = %(uid)s AND j.status = 'running') AS jobs_running,
            (
                (SELECT COALESCE(SUM(i.filesize), 0) FROM images  i WHERE i.owner_id = %(uid)s) +
                (SELECT COALESCE(SUM(v.filesize), 0) FROM vectors v WHERE v.owner_id = %(uid)s) +
                (SELECT COALESCE(SUM(jo.file_size_bytes), 0) FROM job_outputs jo JOIN jobs j ON j.id = jo.job_id WHERE j.owner_id = %(uid)s)
            ) AS storage_bytes
    """, {"uid": owner_id})
    user['stats'] = dict(cur.fetchone())

    # Rolled up across the whole account (shared quota) — what actually
    # counts against the account's plan limit.
    cur.execute("""
        SELECT
            (SELECT COUNT(*) FROM images  i JOIN users u2 ON u2.id = i.owner_id WHERE u2.account_id = %(aid)s) AS image_count,
            (SELECT COUNT(*) FROM jobs    j JOIN users u2 ON u2.id = j.owner_id WHERE u2.account_id = %(aid)s) AS job_count,
            (
                (SELECT COALESCE(SUM(i.filesize), 0) FROM images  i JOIN users u2 ON u2.id = i.owner_id WHERE u2.account_id = %(aid)s) +
                (SELECT COALESCE(SUM(v.filesize), 0) FROM vectors v JOIN users u2 ON u2.id = v.owner_id WHERE u2.account_id = %(aid)s) +
                (SELECT COALESCE(SUM(jo.file_size_bytes), 0) FROM job_outputs jo JOIN jobs j ON j.id = jo.job_id JOIN users u2 ON u2.id = j.owner_id WHERE u2.account_id = %(aid)s)
            ) AS storage_bytes
    """, {"aid": account_id})
    user['account_stats'] = dict(cur.fetchone())

    # Teammates sharing this account (invited users, or the admin if this is one)
    cur.execute("""
        SELECT id, clerk_id, email, username, org_role
        FROM users WHERE account_id = %s AND id != %s
        ORDER BY created_at
    """, (account_id, owner_id))
    user['teammates'] = [dict(r) for r in cur.fetchall()]

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
        SELECT m.id, m.name, m.slug, m.pipeline_type, m.is_active, m.is_free,
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
               'inference_config', 'phase2_config', 'output_types',
               'required_vector_input', 'is_active', 'active']
    for key in allowed:
        if key in data:
            fields.append(f"{key} = %s")
            val = data[key]
            if key in ('inference_config', 'phase2_config', 'output_types', 'required_vector_input') and isinstance(val, dict):
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
    cur.execute("SELECT input_ref, type, input_image_id, input_vector_id FROM jobs WHERE id = %s", (job_id,))
    job_row = cur.fetchone()
    cur.execute("""
        UPDATE jobs SET status = 'cancelled', message = 'Cancelled by superadmin',
        finished_at = now()
        WHERE id = %s AND status IN ('queued', 'running')
        RETURNING id
    """, (job_id,))
    row = cur.fetchone()
    if row and job_row:
        import json as _j
        input_ref = job_row["input_ref"] or {}
        if isinstance(input_ref, str): input_ref = _j.loads(input_ref)
        # ML jobs store image/vector id directly; ingest/transform jobs use input_ref
        image_id = job_row.get("input_image_id") or input_ref.get("image_id")
        vector_id = job_row.get("input_vector_id") or input_ref.get("vector_id")
        if image_id:
            cur.execute("UPDATE images SET status = 'ready' WHERE id = %s", (image_id,))
        if vector_id:
            cur.execute("UPDATE vectors SET status = 'ready' WHERE id = %s", (vector_id,))
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


def get_account_info(clerk_id: str):
    """Self-service view of the caller's own account: who's on it, what plan,
    and (if the caller is org:admin) what models they can hand out."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT u.id, u.account_id, u.org_role, a.plan, a.plan_expires_at, a.clerk_org_id,
               a.storage_limit_gb_override, a.weekly_job_limit_override
        FROM users u JOIN accounts a ON a.id = u.account_id
        WHERE u.clerk_id = %s
    """, (clerk_id,))
    me = cur.fetchone()
    if not me:
        cur.close(); conn.close()
        return None
    me = dict(me)

    cur.execute("SELECT storage_limit_gb, weekly_job_limit FROM tier_limits WHERE tier = %s", (me["plan"],))
    tier_default = cur.fetchone() or {"storage_limit_gb": None, "weekly_job_limit": None}
    storage_limit_gb = me["storage_limit_gb_override"] if me["storage_limit_gb_override"] is not None else tier_default["storage_limit_gb"]
    weekly_job_limit = me["weekly_job_limit_override"] if me["weekly_job_limit_override"] is not None else tier_default["weekly_job_limit"]

    cur.execute("""
        SELECT clerk_id, email, username, org_role
        FROM users WHERE account_id = %s AND id != %s
        ORDER BY created_at
    """, (me["account_id"], me["id"]))
    teammates = [dict(r) for r in cur.fetchall()]

    # The account's own models (what an admin can hand out to teammates) —
    # union of every model granted to any current admin on the account.
    cur.execute("""
        SELECT DISTINCT m.id, m.name, m.pipeline_type
        FROM user_model_permissions p
        JOIN models m ON m.id = p.model_id
        JOIN users u2 ON u2.id = p.user_id
        WHERE u2.account_id = %s AND u2.org_role = 'admin' AND m.is_active = true
    """, (me["account_id"],))
    account_models = [dict(r) for r in cur.fetchall()]

    # Per-teammate model access, so the UI can show checkboxes
    cur.execute("""
        SELECT u2.clerk_id, p.model_id
        FROM user_model_permissions p
        JOIN users u2 ON u2.id = p.user_id
        WHERE u2.account_id = %s AND u2.id != %s
    """, (me["account_id"], me["id"]))
    teammate_models: dict = {}
    for r in cur.fetchall():
        teammate_models.setdefault(r["clerk_id"], []).append(str(r["model_id"]))

    # Account-wide usage — what actually counts against the plan's limits
    cur.execute("""
        SELECT
            (
                (SELECT COALESCE(SUM(i.filesize), 0) FROM images  i JOIN users u2 ON u2.id = i.owner_id WHERE u2.account_id = %(aid)s) +
                (SELECT COALESCE(SUM(v.filesize), 0) FROM vectors v JOIN users u2 ON u2.id = v.owner_id WHERE u2.account_id = %(aid)s) +
                (SELECT COALESCE(SUM(jo.file_size_bytes), 0) FROM job_outputs jo JOIN jobs j ON j.id = jo.job_id JOIN users u2 ON u2.id = j.owner_id WHERE u2.account_id = %(aid)s)
            ) AS storage_bytes,
            (SELECT COUNT(*) FROM jobs j JOIN users u2 ON u2.id = j.owner_id
             WHERE u2.account_id = %(aid)s AND j.created_at > now() - interval '7 days') AS jobs_this_week
    """, {"aid": me["account_id"]})
    usage = dict(cur.fetchone())

    cur.close(); conn.close()
    return {
        "org_role": me["org_role"],
        "account_plan": me["plan"],
        "plan_expires_at": me["plan_expires_at"].isoformat() if me["plan_expires_at"] else None,
        "is_organization": me["clerk_org_id"] is not None,
        "storage_limit_gb": storage_limit_gb,
        "weekly_job_limit": weekly_job_limit,
        "has_custom_limits": me["storage_limit_gb_override"] is not None or me["weekly_job_limit_override"] is not None,
        "storage_bytes": usage["storage_bytes"],
        "jobs_this_week": usage["jobs_this_week"],
        "teammates": teammates,
        "account_models": account_models,
        "teammate_models": teammate_models,
    }


def admin_grant_model_to_teammate(admin_clerk_id: str, teammate_clerk_id: str, model_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, account_id, org_role FROM users WHERE clerk_id = %s", (admin_clerk_id,))
    admin = cur.fetchone()
    if not admin or admin["org_role"] != "admin":
        cur.close(); conn.close()
        return False, "Only an account admin can grant model access"

    cur.execute("SELECT id, account_id FROM users WHERE clerk_id = %s", (teammate_clerk_id,))
    teammate = cur.fetchone()
    if not teammate or teammate["account_id"] != admin["account_id"]:
        cur.close(); conn.close()
        return False, "That user isn't on your account"

    cur.execute(
        "SELECT 1 FROM user_model_permissions WHERE user_id = %s AND model_id = %s",
        (admin["id"], model_id),
    )
    if not cur.fetchone():
        cur.close(); conn.close()
        return False, "You don't have access to that model yourself"

    cur.execute("""
        INSERT INTO user_model_permissions (user_id, model_id, granted_by)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id, model_id) DO NOTHING
    """, (teammate["id"], model_id, admin_clerk_id))
    conn.commit(); cur.close(); conn.close()
    return True, None


def admin_revoke_model_from_teammate(admin_clerk_id: str, teammate_clerk_id: str, model_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT account_id, org_role FROM users WHERE clerk_id = %s", (admin_clerk_id,))
    admin = cur.fetchone()
    if not admin or admin["org_role"] != "admin":
        cur.close(); conn.close()
        return False, "Only an account admin can revoke model access"

    cur.execute("SELECT id, account_id FROM users WHERE clerk_id = %s", (teammate_clerk_id,))
    teammate = cur.fetchone()
    if not teammate or teammate["account_id"] != admin["account_id"]:
        cur.close(); conn.close()
        return False, "That user isn't on your account"

    cur.execute(
        "DELETE FROM user_model_permissions WHERE user_id = %s AND model_id = %s",
        (teammate["id"], model_id),
    )
    conn.commit(); cur.close(); conn.close()
    return True, None


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
