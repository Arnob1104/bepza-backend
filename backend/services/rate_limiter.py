"""
rate_limiter.py — simple in-memory per-user sliding-window rate limiter.

Keyed by user id (not IP), configurable via RATE_LIMIT_PER_MINUTE.

NOTE: this state lives in process memory. It works correctly for a single
backend process (fine for a small deployment on one VPS instance). If you
later run multiple worker processes or replicas behind a load balancer,
each process will track its own counters — move this to Redis (or a
similar shared store) at that point so limits are enforced globally.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

from backend.config import get_settings

settings = get_settings()

_request_log: dict[str, deque] = defaultdict(deque)
WINDOW_SECONDS = 60


def check_rate_limit(user_id: str) -> None:
    now = time.monotonic()
    log = _request_log[user_id]

    # Drop timestamps outside the current window.
    while log and now - log[0] > WINDOW_SECONDS:
        log.popleft()

    if len(log) >= settings.RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({settings.RATE_LIMIT_PER_MINUTE} requests/minute). Please slow down.",
        )

    log.append(now)
