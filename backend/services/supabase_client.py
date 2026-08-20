"""
supabase_client.py — the ONLY module that uses SUPABASE_SECRET_KEY.

Two things live here:
1. Reading/writing the `profiles` table (via PostgREST) to track our own
   is_active flag per user — Supabase Auth handles passwords/tokens, but
   "disable this user" is our own app-level concept layered on top.
2. Calling Supabase's Admin API to create users, list users, and reset
   passwords, so /api/admin/* on our backend can do everything the
   original spec asked for.

Run the SQL in database/supabase_schema.sql once in your Supabase project
(SQL Editor) before using any of this — it creates the `profiles` table
and a trigger that auto-inserts a row (is_active=true) for every new
Supabase Auth user.
"""
import logging

import httpx
from fastapi import HTTPException, status

from backend.config import get_settings

logger = logging.getLogger("supabase_client")
settings = get_settings()

REQUEST_TIMEOUT = 15


def _admin_headers() -> dict:
    return {
        "apikey": settings.SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
    }


# ── profiles table (is_active flag) ─────────────────────────────────────
async def get_is_active(user_id: str) -> bool:
    url = f"{settings.SUPABASE_URL}/rest/v1/profiles"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.get(
            url, headers=_admin_headers(),
            params={"id": f"eq.{user_id}", "select": "is_active"},
        )
    if resp.status_code != 200:
        logger.error("Failed to read profile is_active for %s: %s", user_id, resp.text[:300])
        # Fail closed: if we can't confirm the account is active, don't let it through.
        return False
    rows = resp.json()
    if not rows:
        # No profile row (trigger didn't fire, or user predates the trigger).
        # Fail closed rather than silently trusting an unknown account.
        logger.warning("No profile row found for user %s", user_id)
        return False
    return bool(rows[0].get("is_active", False))


async def set_is_active(user_id: str, is_active: bool) -> None:
    url = f"{settings.SUPABASE_URL}/rest/v1/profiles"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.patch(
            url, headers={**_admin_headers(), "Prefer": "return=minimal"},
            params={"id": f"eq.{user_id}"},
            json={"is_active": is_active},
        )
    if resp.status_code not in (200, 204):
        logger.error("Failed to update profile for %s: %s", user_id, resp.text[:300])
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not update user status.")


# ── Supabase Admin API (user accounts) ──────────────────────────────────
async def admin_create_user(email: str, password: str) -> dict:
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(
            url, headers=_admin_headers(),
            json={"email": email, "password": password, "email_confirm": True},
        )
    if resp.status_code not in (200, 201):
        logger.error("Supabase admin_create_user failed: %s", resp.text[:300])
        detail = "A user with this email already exists." if resp.status_code == 422 else "Could not create user."
        raise HTTPException(status_code=status.HTTP_409_CONFLICT if resp.status_code == 422 else status.HTTP_502_BAD_GATEWAY, detail=detail)
    return resp.json()


async def admin_list_users() -> list[dict]:
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        users_resp = await client.get(url, headers=_admin_headers())
        if users_resp.status_code != 200:
            logger.error("Supabase admin_list_users failed: %s", users_resp.text[:300])
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not list users.")
        users = users_resp.json().get("users", [])

        profiles_resp = await client.get(
            f"{settings.SUPABASE_URL}/rest/v1/profiles",
            headers=_admin_headers(), params={"select": "id,is_active"},
        )
        profiles_by_id = {}
        if profiles_resp.status_code == 200:
            profiles_by_id = {p["id"]: p.get("is_active", True) for p in profiles_resp.json()}

    return [
        {
            "id": u["id"],
            "email": u.get("email", ""),
            "is_active": profiles_by_id.get(u["id"], True),
            "created_at": u.get("created_at", ""),
        }
        for u in users
    ]


async def admin_reset_password(user_id: str, new_password: str) -> None:
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.put(url, headers=_admin_headers(), json={"password": new_password})
    if resp.status_code != 200:
        logger.error("Supabase admin_reset_password failed: %s", resp.text[:300])
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reset password.")
