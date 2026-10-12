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


class _Models:
    """Stands in for client.models: answers per model, or raises the queued error."""

    def __init__(self, replies: dict):
        self.replies = replies
        self.asked: list[str] = []

    def generate_content(self, model, contents, config):
        from types import SimpleNamespace

        self.asked.append(model)
        reply = self.replies[model]
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(text=reply, usage_metadata=None)


def _llm(replies: dict, fallback: str = "fallback-model"):
    from types import SimpleNamespace

    from app.config import Settings
    from app.llm import GeminiLLM

    settings = Settings(gemini_model="main-model", gemini_fallback_model=fallback)
    models = _Models(replies)
    used = []
    llm = GeminiLLM(
        settings,
        client=SimpleNamespace(models=models),
        on_usage=lambda schema, model, usage, s: used.append(model),
    )
    return llm, models, used


def test_busy_main_model_falls_back_once() -> None:
    from app.models import ManualPick

    reply = '{"manual_id": null, "why": "none"}'
    llm, models, used = _llm({"main-model": overloaded_error(429), "fallback-model": reply})
    assert llm.generate("q", ManualPick).manual_id is None
    assert models.asked == ["main-model", "fallback-model"]
    assert used == ["fallback-model"]


def test_other_errors_and_disabled_fallback_still_raise() -> None:
    import pytest

    from app.models import ManualPick

    llm, models, _ = _llm({"main-model": overloaded_error(400), "fallback-model": "{}"})
    with pytest.raises(Exception, match="400"):
        llm.generate("q", ManualPick)
    assert models.asked == ["main-model"]

    llm, models, _ = _llm({"main-model": overloaded_error(503)}, fallback="")
    with pytest.raises(Exception, match="503"):
        llm.generate("q", ManualPick)
