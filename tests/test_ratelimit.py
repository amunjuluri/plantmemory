import pytest
from fastapi import HTTPException

from app.ratelimit import RateLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_allows_limit_then_blocks_until_window_passes() -> None:
    clock = Clock()
    limiter = RateLimiter(2, clock=clock)
    limiter.check("a")
    limiter.check("a")
    with pytest.raises(HTTPException) as err:
        limiter.check("a")
    assert err.value.status_code == 429
    assert "Retry-After" in err.value.headers
    limiter.check("b")  # other clients are unaffected
    clock.now = 3601
    limiter.check("a")


def test_zero_disables_the_limit() -> None:
    limiter = RateLimiter(0)
    for _ in range(100):
        limiter.check("a")
