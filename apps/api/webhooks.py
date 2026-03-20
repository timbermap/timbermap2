import os
from fastapi import APIRouter, Request, HTTPException
from svix.webhooks import Webhook, WebhookVerificationError
import psycopg2
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

def get_db_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )

@router.post("/webhooks/clerk")
async def clerk_webhook(request: Request):
    payload = await request.body()
    headers = dict(request.headers)
    secret = os.getenv("CLERK_WEBHOOK_SECRET")

    try:
        wh = Webhook(secret)
        event = wh.verify(payload, headers)
    except WebhookVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type")
    data = event.get("data", {})

    if event_type == "user.created":
        clerk_id = data.get("id")
        email = data.get("email_addresses", [{}])[0].get("email_address", "")
        username = data.get("username") or email.split("@")[0]
        first_name = data.get("first_name", "")

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO users (clerk_id, email, username)
            VALUES (%s, %s, %s)
            ON CONFLICT (clerk_id) DO NOTHING
        """, (clerk_id, email, username))
        conn.commit()
        cur.close()
        conn.close()

    elif event_type == "user.deleted":
        clerk_id = data.get("id")
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM users WHERE clerk_id = %s", (clerk_id,))
        conn.commit()
        cur.close()
        conn.close()

    return {"status": "ok"}
