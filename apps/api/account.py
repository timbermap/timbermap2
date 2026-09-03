"""
apps/api/account.py
Self-service endpoints for the calling user's own account/team — distinct
from superadmin.py, which manages every account. An org:admin can only see
and manage their own teammates here, never anyone else's.
"""

import os
import secrets
import datetime
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
import resend

import database

router = APIRouter(prefix="/account", tags=["account"])

UPGRADE_EMAIL  = "sebastian@timbermap.com"
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
WEB_URL        = os.getenv("WEB_PUBLIC_URL", "https://app.timbermap.com")


def current_user(x_clerk_id: str = Header(..., alias="x-clerk-id")) -> str:
    if not database.get_user_id(x_clerk_id):
        raise HTTPException(404, "User not found")
    return x_clerk_id


class EnsureAccountRequest(BaseModel):
    email: str
    username: str


@router.post("/ensure")
def ensure_account(body: EnsureAccountRequest, x_clerk_id: str = Header(..., alias="x-clerk-id")):
    """Called once on dashboard load. Provisions the users row (+ personal
    account, + free-model grants) if the Clerk webhook hasn't landed yet —
    without this, a brand-new user 404s on anything besides /upload/signed-url,
    the only other endpoint that self-heals via ensure_user()."""
    database.ensure_user(x_clerk_id, body.email, body.username)
    return {"ok": True}


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


# ── Team (our own, no Clerk Organizations) ─────────────────────────────────────

class CreateTeamRequest(BaseModel):
    name: str


@router.post("/team")
def create_team(body: CreateTeamRequest, clerk_id: str = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Team name can't be empty")
    ok, error = database.create_team(clerk_id, name)
    if not ok:
        raise HTTPException(400, error)
    return {"created": True, "name": name}


@router.put("/team")
def update_team(body: CreateTeamRequest, clerk_id: str = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Team name can't be empty")
    if not database.rename_team(clerk_id, name):
        raise HTTPException(403, "Only a team admin can rename the team")
    return {"renamed": True, "name": name}


class InviteRequest(BaseModel):
    email: str


@router.post("/team/invite")
def invite_to_team(body: InviteRequest, clerk_id: str = Depends(current_user)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Invalid email")
    token = secrets.token_urlsafe(32)
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
    result, error = database.create_team_invite(clerk_id, email, token, expires_at)
    if not result:
        raise HTTPException(403, error)

    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            resend.Emails.send({
                "from": "Timbermap <contact@timbermap.com>",
                "to": [email],
                "subject": f"You've been invited to join {result['team_name']} on Timbermap",
                "html": f"""
                    <h2>Join {result['team_name']} on Timbermap</h2>
                    <p>You've been invited to join a team on Timbermap — shared storage, processing
                    quota, and model access.</p>
                    <p><a href="{WEB_URL}/team-invite/{token}">Accept invite →</a></p>
                    <p style="color:#888;font-size:.85em">This invite expires in 7 days.</p>
                """
            })
        except Exception as e:
            print(f"Invite email error: {e}")

    return {"invited": True, "email": email}


@router.delete("/team/invite/{invite_id}")
def cancel_invite(invite_id: str, clerk_id: str = Depends(current_user)):
    if not database.revoke_team_invite(clerk_id, invite_id):
        raise HTTPException(404, "Invite not found")
    return {"revoked": True}


@router.get("/team/invite/{token}")
def get_invite(token: str):
    """Unauthenticated on purpose — this is the landing page for an emailed
    invite link, hit before the invitee is necessarily signed in yet. The
    token itself is the secret; knowing it is what grants read access."""
    invite = database.get_team_invite(token)
    if not invite:
        raise HTTPException(404, "Invite not found")
    return {
        "email": invite["email"],
        "team_name": invite["team_name"],
        "status": invite["status"],
        "expires_at": invite["expires_at"].isoformat(),
    }


@router.post("/team/invite/{token}/accept")
def accept_invite(token: str, clerk_id: str = Depends(current_user)):
    ok, error = database.accept_team_invite(clerk_id, token)
    if not ok:
        raise HTTPException(400, error)
    return {"accepted": True}


@router.delete("/teammates/{teammate_clerk_id}")
def remove_teammate(teammate_clerk_id: str, clerk_id: str = Depends(current_user)):
    ok, error = database.remove_teammate(clerk_id, teammate_clerk_id)
    if not ok:
        raise HTTPException(403, error)
    return {"removed": True, "teammate": teammate_clerk_id}


@router.post("/team/leave")
def leave_team(clerk_id: str = Depends(current_user)):
    ok, error = database.leave_team(clerk_id)
    if not ok:
        raise HTTPException(400, error)
    return {"left": True}
