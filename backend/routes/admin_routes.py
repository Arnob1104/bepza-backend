"""
admin_routes.py — user management for the extension owner, now delegating
to Supabase (Auth for accounts, the `profiles` table for our own
is_active flag). Still protected by a single shared secret (X-Admin-Key
header) checked against ADMIN_API_KEY — the extension never sees
ADMIN_API_KEY or SUPABASE_SECRET_KEY and has no access to these routes.
"""
from fastapi import APIRouter, Depends, Header, HTTPException, status

from backend.config import get_settings
from backend.models.schemas import PasswordReset, UserCreate, UserOut, UserStatusUpdate
from backend.services.supabase_client import (
    admin_create_user,
    admin_list_users,
    admin_reset_password,
    set_is_active,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])
settings = get_settings()


def require_admin(x_admin_key: str = Header(default="")) -> None:
    if not settings.ADMIN_API_KEY or x_admin_key != settings.ADMIN_API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin key.")


@router.post("/users", response_model=UserOut, dependencies=[Depends(require_admin)])
async def create_user(body: UserCreate):
    user = await admin_create_user(body.email.lower(), body.password)
    # The profiles row is created automatically by the Supabase trigger
    # (see database/supabase_schema.sql), so it's already is_active=true.
    return UserOut(id=user["id"], email=user.get("email", ""), is_active=True, created_at=user.get("created_at", ""))


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(require_admin)])
async def list_users():
    users = await admin_list_users()
    return [UserOut(**u) for u in users]


@router.patch("/users/{user_id}/status", dependencies=[Depends(require_admin)])
async def set_user_status(user_id: str, body: UserStatusUpdate):
    await set_is_active(user_id, body.is_active)
    # Note: an already-issued Supabase access token stays cryptographically
    # valid until it expires (Supabase tokens default to ~1 hour), but
    # get_current_user re-checks is_active against Supabase on every
    # request, so a disabled user is locked out on their very next API
    # call regardless of token expiry.
    return {"id": user_id, "is_active": body.is_active}


@router.post("/users/{user_id}/reset-password", dependencies=[Depends(require_admin)])
async def reset_password(user_id: str, body: PasswordReset):
    await admin_reset_password(user_id, body.new_password)
    return {"id": user_id, "status": "password reset"}
