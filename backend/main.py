"""
main.py — FastAPI app entrypoint.

Run locally with:
    uvicorn backend.main:app --reload --port 8000

See ../README.md for full setup, deployment, and admin instructions.

Note on architecture: this backend no longer has its own user database or
JWT issuance — Supabase Auth owns accounts and tokens (see auth/supabase_verify.py
and services/supabase_client.py). This backend's job is narrower and more
focused: verify the Supabase token on each request, enforce our own
is_active flag, rate-limit, and be the only thing that ever talks to the
AI provider.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import get_settings
from backend.routes import admin_routes, extract_routes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    problems = settings.validate()
    if problems:
        for p in problems:
            logger.warning("Config warning: %s", p)
    else:
        logger.info("Config OK. Backend ready.")
    yield


app = FastAPI(title="BEPZA Autofiller Backend", version="2.0.0", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────
# Deliberately NOT allow_origins=["*"]. A Chrome extension's origin looks
# like "chrome-extension://<32-character-extension-id>" — see README for
# how to find your extension's exact ID and set ALLOWED_ORIGINS to it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key"],
)

app.include_router(extract_routes.router)
app.include_router(admin_routes.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Something went wrong. Please try again."},
    )


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    return await http_exception_handler(request, exc)
