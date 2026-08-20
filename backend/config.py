"""
config.py — central settings, loaded ONLY from environment variables.

Nothing AI-provider-specific (key, URL, model) and nothing Supabase-secret
is ever hardcoded here or anywhere else in this backend. Copy .env.example
to .env (in this same backend/ directory) and fill in real values for
local development; in production, set these as real environment variables
on your host/platform instead of shipping a .env file.
"""
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


class Settings:
    # ── AI provider (server-side only — NEVER sent to the extension) ──
    AI_API_KEY: str = os.environ.get("AI_API_KEY", "")
    AI_API_URL: str = os.environ.get("AI_API_URL", "")
    AI_MODEL: str = os.environ.get("AI_MODEL", "")

    # ── Supabase ──
    # SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are also used by the
    # extension directly (they're meant to be public — Supabase's
    # "publishable" key is the client-safe key, same role as the old
    # "anon" key). SUPABASE_SECRET_KEY must NEVER leave this backend —
    # it grants full admin access to your Supabase project.
    SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
    SUPABASE_PUBLISHABLE_KEY: str = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    SUPABASE_SECRET_KEY: str = os.environ.get("SUPABASE_SECRET_KEY", "")
    SUPABASE_JWKS_URL: str = os.environ.get("SUPABASE_JWKS_URL", "")

    # ── Admin API (protects /api/admin/* on OUR backend) ──
    ADMIN_API_KEY: str = os.environ.get("ADMIN_API_KEY", "")

    # ── CORS ──
    # Comma-separated list. For a Chrome extension this is
    # "chrome-extension://<your-extension-id>" — see README for how to find it.
    ALLOWED_ORIGINS: list[str] = [
        o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]

    # ── Rate limiting ──
    RATE_LIMIT_PER_MINUTE: int = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "10"))

    ENV: str = os.environ.get("ENV", "development")

    def validate(self) -> list[str]:
        problems = []
        if not self.AI_API_KEY:
            problems.append("AI_API_KEY is not set")
        if not self.AI_API_URL:
            problems.append("AI_API_URL is not set")
        if not self.AI_MODEL:
            problems.append("AI_MODEL is not set")
        if not self.SUPABASE_URL:
            problems.append("SUPABASE_URL is not set")
        if not self.SUPABASE_PUBLISHABLE_KEY:
            problems.append("SUPABASE_PUBLISHABLE_KEY is not set")
        if not self.SUPABASE_SECRET_KEY:
            problems.append("SUPABASE_SECRET_KEY is not set")
        if not self.SUPABASE_JWKS_URL:
            problems.append("SUPABASE_JWKS_URL is not set")
        if not self.ADMIN_API_KEY:
            problems.append("ADMIN_API_KEY is not set")
        if not self.ALLOWED_ORIGINS:
            problems.append("ALLOWED_ORIGINS is not set (CORS will reject the extension)")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
