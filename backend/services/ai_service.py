"""
ai_service.py — the ONLY module in this codebase that talks to the AI
provider. AI_API_KEY / AI_API_URL / AI_MODEL are read from environment
variables here and nowhere else. Errors raised out of this module are
always generic (logged in full server-side, never echoed to the client),
so a client inspecting responses can't learn which provider or model is
in use.
"""
import asyncio
import json
import logging

import httpx
from fastapi import HTTPException, status

from backend.config import get_settings
from backend.services.prompts import PROMPTS_BY_DOC_TYPE

logger = logging.getLogger("ai_service")
settings = get_settings()

MAX_ATTEMPTS = 4
REQUEST_TIMEOUT_SECONDS = 30
MAX_INPUT_CHARS = 12000  # matches the previous client-side truncation


async def extract(doc_type: str, text: str) -> dict:
    system_prompt = PROMPTS_BY_DOC_TYPE.get(doc_type)
    if system_prompt is None:
        # Not an AI-provider concern — this is just bad input from the client.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown doc_type.")

    if not settings.AI_API_KEY or not settings.AI_API_URL or not settings.AI_MODEL:
        logger.error("AI provider is not configured (missing AI_API_KEY/AI_API_URL/AI_MODEL env vars).")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Extraction service is temporarily unavailable. Please try again shortly.",
        )

    payload = {
        "model": settings.AI_MODEL,
        "temperature": 0,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text[:MAX_INPUT_CHARS]},
        ],
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.AI_API_KEY}",
    }

    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await client.post(settings.AI_API_URL, headers=headers, json=payload)
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning("AI provider request failed (attempt %d/%d): %s", attempt, MAX_ATTEMPTS, exc)
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(2 ** (attempt - 1))
                    continue
                break

            if response.status_code == 200:
                try:
                    data = response.json()
                    content = data["choices"][0]["message"]["content"]
                    return json.loads(content)
                except (KeyError, IndexError, json.JSONDecodeError) as exc:
                    logger.error("AI provider returned an unparseable response: %s", exc)
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="Extraction failed to produce readable results. Please try again.",
                    )

            # Transient errors — retry with backoff, same as the previous
            # client-side logic (429 rate-limited, 503 overloaded).
            if response.status_code in (429, 503) and attempt < MAX_ATTEMPTS:
                logger.warning(
                    "AI provider returned %d (attempt %d/%d), retrying...",
                    response.status_code, attempt, MAX_ATTEMPTS,
                )
                await asyncio.sleep(2 ** (attempt - 1))
                continue

            # Non-retryable, or retries exhausted — log full detail server-side,
            # never forward the raw provider error body to the client.
            logger.error(
                "AI provider error %d on attempt %d: %s",
                response.status_code, attempt, response.text[:500],
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Extraction service is temporarily unable to process this document. Please try again shortly.",
            )

    logger.error("AI provider unreachable after %d attempts: %s", MAX_ATTEMPTS, last_error)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Extraction service is temporarily unavailable. Please try again shortly.",
    )
