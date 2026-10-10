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
