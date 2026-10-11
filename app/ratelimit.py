"""A small per-client limit on the endpoints that call Gemini.

The demo link is public, so this caps what one visitor can spend. It is per instance
and in memory: Cloud Run's max-instances bounds the total.
"""

import threading
import time
from collections import deque

from fastapi import HTTPException, Request
from starlette.requests import HTTPConnection

from app.config import get_settings

WINDOW_SECONDS = 3600.0


class RateLimiter:
    """Allows `limit` calls per client in any rolling hour. `limit <= 0` disables it."""

    def __init__(self, limit: int, clock=time.monotonic):
        self.limit = limit
        self._clock = clock
        self._calls: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, client: str) -> None:
        """Record a call, or raise HTTP 429 if the client is over its limit."""
        if self.limit <= 0:
            return
        now = self._clock()
        with self._lock:
            calls = self._calls.setdefault(client, deque())
            while calls and now - calls[0] > WINDOW_SECONDS:
                calls.popleft()
            if len(calls) >= self.limit:
                retry = int(WINDOW_SECONDS - (now - calls[0])) + 1
                raise HTTPException(
                    status_code=429,
                    detail="This demo allows a limited number of AI requests per hour. "
                    "Please try again later.",
                    headers={"Retry-After": str(retry)},
                )
            calls.append(now)
            if len(self._calls) > 10_000:  # forget idle clients
                stale = [c for c, q in self._calls.items() if not q or now - q[-1] > WINDOW_SECONDS]
                for c in stale:
                    del self._calls[c]


def client_id(request: HTTPConnection) -> str:
    """The caller's IP: first X-Forwarded-For hop on Cloud Run, else the socket peer."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = RateLimiter(get_settings().ai_requests_per_hour)


def limit_ai_calls(request: Request) -> None:
    """FastAPI dependency for routes that spend Gemini calls."""
    limiter.check(client_id(request))
