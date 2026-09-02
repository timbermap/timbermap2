import os
import logging
from fastapi import APIRouter, Request, HTTPException
from svix.webhooks import Webhook, WebhookVerificationError
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
logger = logging.getLogger("clerk_webhook")

def get_db_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=psycopg2.extras.RealDictCursor,
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
    logger.warning("CLERK_WEBHOOK event=%s data=%s", event_type, data)

    if event_type == "user.created":
        clerk_id = data.get("id")
        email = data.get("email_addresses", [{}])[0].get("email_address", "")
        username = data.get("username") or email.split("@")[0]

        conn = get_db_conn()
        cur = conn.cursor()
        # Every user gets a personal account by default. If they're actually
        # joining someone else's org, the organizationMembership.created
        # event (which follows shortly after for invited signups) moves
        # them onto the org's account instead.
        cur.execute("INSERT INTO accounts DEFAULT VALUES RETURNING id")
        account_id = cur.fetchone()["id"]
        cur.execute("""
            INSERT INTO users (clerk_id, email, username, account_id)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (clerk_id) DO NOTHING
        """, (clerk_id, email, username, account_id))
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

    elif event_type == "organizationMembership.created":
        org_id   = data.get("organization", {}).get("id")
        user_id  = data.get("public_user_data", {}).get("user_id")
        role     = data.get("role", "")  # "org:admin" or "org:member"
        org_role = "admin" if role.endswith("admin") else "member"

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT id FROM accounts WHERE clerk_org_id = %s", (org_id,))
        account = cur.fetchone()
        if not account:
            # First membership event for this org — this is the creator.
            # Adopt their existing personal account as the org's account
            # rather than spinning up a new one.
            cur.execute("""
                UPDATE accounts SET clerk_org_id = %s
                WHERE id = (SELECT account_id FROM users WHERE clerk_id = %s)
                RETURNING id
            """, (org_id, user_id))
            account = cur.fetchone()
        else:
            # An invited member joining an existing org — move them onto
            # the org's shared account. Their old personal account (if any)
            # is simply left behind, unused.
            cur.execute(
                "UPDATE users SET account_id = %s WHERE clerk_id = %s",
                (account["id"], user_id),
            )
        cur.execute(
            "UPDATE users SET org_role = %s WHERE clerk_id = %s",
            (org_role, user_id),
        )
        conn.commit()
        cur.close()
        conn.close()

    elif event_type == "organizationMembership.deleted":
        user_id = data.get("public_user_data", {}).get("user_id")
        conn = get_db_conn()
        cur = conn.cursor()
        # Removed from the org — give them back a personal account rather
        # than leaving them attached to their former team's shared quota.
        cur.execute("INSERT INTO accounts DEFAULT VALUES RETURNING id")
        new_account_id = cur.fetchone()["id"]
        cur.execute(
            "UPDATE users SET account_id = %s, org_role = NULL WHERE clerk_id = %s",
            (new_account_id, user_id),
        )
        conn.commit()
        cur.close()
        conn.close()

    return {"status": "ok"}
