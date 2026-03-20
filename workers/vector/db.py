import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

def get_conn():
    host = os.getenv("DB_HOST", "127.0.0.1")
    if host.startswith("/cloudsql"):
        conn_str = (
            f"host={host} "
            f"dbname={os.getenv('DB_NAME', 'timbermap')} "
            f"user={os.getenv('DB_USER', 'postgres')} "
            f"password={os.getenv('DB_PASSWORD')}"
        )
    else:
        conn_str = (
            f"host={host} "
            f"port={os.getenv('DB_PORT', 5432)} "
            f"dbname={os.getenv('DB_NAME', 'timbermap')} "
            f"user={os.getenv('DB_USER', 'postgres')} "
            f"password={os.getenv('DB_PASSWORD')}"
        )
    return psycopg2.connect(conn_str, cursor_factory=psycopg2.extras.RealDictCursor)
