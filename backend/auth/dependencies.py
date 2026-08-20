"""
dependencies.py — FastAPI dependency that validates the Supabase access
token on every protected request, then re-checks our own is_active flag
against Supabase on every single request (not just at login) so a
disabled user is locked out on their very next call, even if their token
hasn't expired yet.
"""
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.auth.supabase_verify import verify_supabase_token
from backend.services.supabase_client import get_is_active

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: str       # Supabase auth.users.id (uuid)
    email: str


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session. Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized

    payload = await verify_supabase_token(credentials.credentials)
    if payload is None:
        raise unauthorized

    user_id = payload.get("sub")
    email = payload.get("email", "")
    if user_id is None:
        raise unauthorized

    if not await get_is_active(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been disabled. Contact your administrator.",
        )

    return CurrentUser(id=user_id, email=email)
