"""
apps/api/account.py
Self-service endpoints for the calling user's own account/team — distinct
from superadmin.py, which manages every account. An org:admin can only see
and manage their own teammates here, never anyone else's.
"""

from fastapi import APIRouter, Depends, HTTPException, Header

import database

router = APIRouter(prefix="/account", tags=["account"])


def current_user(x_clerk_id: str = Header(..., alias="x-clerk-id")) -> str:
    if not database.get_user_id(x_clerk_id):
        raise HTTPException(404, "User not found")
    return x_clerk_id


@router.get("/me")
def get_my_account(clerk_id: str = Depends(current_user)):
    info = database.get_account_info(clerk_id)
    if not info:
        raise HTTPException(404, "User not found")
    return info


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
