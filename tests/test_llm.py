import httpx

from app.llm import is_overloaded
from tests.fakes import overloaded_error


def test_overload_is_detected_through_wrapping() -> None:
    try:
        try:
            raise overloaded_error(429)
        except Exception as inner:
            raise RuntimeError("agent failed") from inner
    except RuntimeError as outer:
        assert is_overloaded(outer)
    assert is_overloaded(ExceptionGroup("tasks", [ValueError(), overloaded_error(503)]))
    assert is_overloaded(httpx.ReadTimeout("slow"))


def test_other_errors_are_not_overload() -> None:
    assert not is_overloaded(overloaded_error(400))
    assert not is_overloaded(ValueError("bad json"))
    assert not is_overloaded(None)


def test_hedged_call_returns_the_first_answer() -> None:
    import threading
    import time

    from app.llm import _hedged

    calls = []
    lock = threading.Lock()

    def call():
        with lock:
            calls.append(1)
            n = len(calls)
        if n == 1:
            time.sleep(0.5)  # the first copy is stuck
            return "slow"
        return "fast"

    assert _hedged(call, after_s=0.05) == "fast"
    assert len(calls) == 2


def test_hedged_call_raises_only_when_every_copy_fails() -> None:
    from app.llm import _hedged

    def fail():
        raise ValueError("boom")

    import pytest

    with pytest.raises(ValueError):
        _hedged(fail, after_s=0.01)
