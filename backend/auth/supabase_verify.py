"""
supabase_verify.py — verifies a Supabase Auth access token.

Supabase Auth (not this backend) now issues and signs tokens when a user
logs in, using its own private key. This module fetches Supabase's public
JWKS (JSON Web Key Set) and uses it to verify a token's signature and
expiry, without ever needing Supabase's private signing key or our own
JWT secret. The JWKS is cached in memory and refreshed periodically.
"""
import logging
import time
from typing import Optional

import httpx
from jose import jwt
from jose.exceptions import JWTError

from backend.config import get_settings

logger = logging.getLogger("supabase_verify")
settings = get_settings()

_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}
JWKS_CACHE_TTL_SECONDS = 3600


async def _get_jwks() -> dict:
    now = time.monotonic()
    if _jwks_cache["keys"] is not None and (now - _jwks_cache["fetched_at"]) < JWKS_CACHE_TTL_SECONDS:
        return _jwks_cache["keys"]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(settings.SUPABASE_JWKS_URL)
        resp.raise_for_status()
        keys = resp.json()

    _jwks_cache["keys"] = keys
    _jwks_cache["fetched_at"] = now
    return keys


async def verify_supabase_token(token: str) -> Optional[dict]:
    """Returns the decoded payload (contains 'sub' = Supabase user id and
    'email') if the token is valid and unexpired, otherwise None."""
    try:
        jwks = await _get_jwks()
        unverified_header = jwt.get_unverified_header(token)
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == unverified_header.get("kid")), None)
        if key is None:
            # Key rotated since we cached — refetch once and try again.
            _jwks_cache["keys"] = None
            jwks = await _get_jwks()
            key = next((k for k in jwks.get("keys", []) if k.get("kid") == unverified_header.get("kid")), None)
            if key is None:
                return None

        payload = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "RS256")],
            audience="authenticated",
            options={"verify_aud": True},
        )
        return payload
    except JWTError as exc:
        logger.info("Token verification failed: %s", exc)
        return None
    except httpx.HTTPError as exc:
        logger.error("Could not fetch Supabase JWKS: %s", exc)
        return None
