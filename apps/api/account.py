"""
apps/api/account.py
Self-service endpoints for the calling user's own account/team — distinct
from superadmin.py, which manages every account. An org:admin can only see
and manage their own teammates here, never anyone else's.
"""

import os
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
import resend

import database

router = APIRouter(prefix="/account", tags=["account"])

UPGRADE_EMAIL  = "sebastian@timbermap.com"
RESEND_API_KEY = os.getenv("RESEND_API_KEY")


def current_user(x_clerk_id: str = Header(..., alias="x-clerk-id")) -> str:
    if not database.get_user_id(x_clerk_id):
        raise HTTPException(404, "User not found")
    return x_clerk_id


@router.get("/tier-limits")
def get_tier_limits_public(clerk_id: str = Depends(current_user)):
    """Read-only for any signed-in user — powers the "your limits" panel."""
    return {"tiers": database.get_tier_limits()}


@router.get("/me")
def get_my_account(clerk_id: str = Depends(current_user)):
    info = database.get_account_info(clerk_id)
    if not info:
        raise HTTPException(404, "User not found")
    return info


class PlanUpgradeRequest(BaseModel):
    message: str = ""


@router.post("/request-upgrade")
def request_plan_upgrade(body: PlanUpgradeRequest, clerk_id: str = Depends(current_user)):
    """Sends an email to the team — no self-serve billing yet, this is the
    stand-in until card payments are wired up."""
    conn = database.get_conn(); cur = conn.cursor()
    cur.execute("""
        SELECT u.email, u.username, a.plan AS account_plan
        FROM users u JOIN accounts a ON a.id = u.account_id
        WHERE u.clerk_id = %s
    """, (clerk_id,))
    row = cur.fetchone()
    cur.close(); conn.close()
    if not row:
        raise HTTPException(404, "User not found")

    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [UPGRADE_EMAIL],
                "subject": f"Subscription upgrade request — {row['email']}",
                "html": f"""
                    <h2>Subscription upgrade request</h2>
                    <p><b>User:</b> {row['username']} ({row['email']})</p>
                    <p><b>Current plan:</b> {row['account_plan']}</p>
                    <p><b>Message:</b><br>{body.message or '(no message)'}</p>
                """
            })
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [row["email"]],
                "subject": "We received your upgrade request",
                "html": f"""
                    <h2>Request received</h2>
                    <p>Hi {row['username']},</p>
                    <p>We got your request to upgrade your Timbermap plan. We'll be in touch shortly.</p>
                    <br>
                    <p>— The Timbermap team</p>
                """
            })
        except Exception as e:
            print(f"Email error: {e}")

    return {"status": "sent"}


@router.post("/teammates/{teammate_clerk_id}/models/{model_id}")
def grant_model_to_teammate(teammate_clerk_id: str, model_id: str, clerk_id: str = Depends(current_user)):
    ok, error = database.admin_grant_model_to_teammate(clerk_id, teammate_clerk_id, model_id)
    if not ok:
        raise HTTPException(403, error)
    return {"granted": True, "teammate": teammate_clerk_id, "model_id": model_id}


@router.delete("/teammates/{teammate_clerk_id}/models/{model_id}")
def revoke_model_from_teammate(teammate_clerk_id: str, model_id: str, clerk_id: str = Depends(current_user)):
    ok, error = database.admin_revoke_model_from_teammate(clerk_id, teammate_clerk_id, model_id)
    if not ok:
        raise HTTPException(403, error)
    return {"revoked": True, "teammate": teammate_clerk_id, "model_id": model_id}
