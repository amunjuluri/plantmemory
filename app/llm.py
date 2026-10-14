"""Gemini client and a small structured-output helper shared by the agent and ingest."""

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Literal, Protocol, TypeVar

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from app.config import Settings, get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
ThinkingLevel = Literal["low", "medium", "high"]  # "minimal" is not accepted by every model

# Vertex AI answers 429 when shared Gemini capacity is briefly exhausted, and 503 when
# overloaded. Both usually clear within seconds, so every Gemini call retries them with
# backoff (about 2 + 4 + 8 s) before giving up.
OVERLOADED_CODES = (429, 503)
RETRY = types.HttpRetryOptions(
    attempts=4,
    initial_delay=2.0,
    max_delay=10.0,
    exp_base=2.0,
    jitter=1.0,
    http_status_codes=[*OVERLOADED_CODES, 500, 502, 504],
)
# A call that hangs is cut off and retried like a 429. Agent turns are short text calls
# (normally 2 to 8 s); reading a logbook photo can take much longer.
AGENT_CALL_TIMEOUT_MS = 30_000
CALL_TIMEOUT_MS = 90_000
BUSY_MESSAGE = "Gemini is busy right now. Please try again in a minute."


def is_overloaded(err: BaseException | None) -> bool:
    """True if `err`, or anything it wraps, is Gemini out of capacity or too slow."""
    seen: set[int] = set()
    stack = [err]
    while stack:
        e = stack.pop()
        if e is None or id(e) in seen:
            continue
        seen.add(id(e))
        if isinstance(e, errors.APIError) and e.code in OVERLOADED_CODES:
            return True
        if isinstance(e, httpx.TimeoutException):
            return True
        if isinstance(e, BaseExceptionGroup):
            stack.extend(e.exceptions)
        stack.extend([e.__cause__, e.__context__])
    return False


_client: genai.Client | None = None
_client_lock = threading.Lock()


def get_genai_client() -> genai.Client:
    """Return the shared google-genai client for Vertex AI or the Gemini API.

    Created once under a lock: if two threads each built a client, the spare one's
    cleanup would close the connection the other is using.
    """
    global _client
    with _client_lock:
        if _client is None:
            _client = _new_client()
        return _client


def _new_client() -> genai.Client:
    s = get_settings()
    http_options = types.HttpOptions(retry_options=RETRY, timeout=CALL_TIMEOUT_MS)
    if s.use_vertexai:
        return genai.Client(
            vertexai=True,
            project=s.google_cloud_project,
            location=s.google_cloud_location,
            http_options=http_options,
        )
    api_key = s.google_api_key.get_secret_value() if s.google_api_key else None
    return genai.Client(api_key=api_key, http_options=http_options)


_live_client: genai.Client | None = None


def get_live_client() -> genai.Client:
    """A client for Gemini Live, which on Vertex AI is served from `live_location`."""
    global _live_client
    with _client_lock:
        if _live_client is None:
            s = get_settings()
            if s.use_vertexai:
                _live_client = genai.Client(
                    vertexai=True, project=s.google_cloud_project, location=s.live_location
                )
            else:
                api_key = s.google_api_key.get_secret_value() if s.google_api_key else None
                _live_client = genai.Client(api_key=api_key)
        return _live_client


class StructuredLLM(Protocol):
    """Anything that can turn a prompt into a validated Pydantic object."""

    def generate(
        self,
        contents: types.ContentListUnion,
        schema: type[T],
        thinking: ThinkingLevel = "low",
        timeout_ms: int | None = None,
        hedge_after_s: float | None = None,
    ) -> T: ...


# Called after every Gemini answer with the schema's name, the model that answered, the
# token counts and the seconds the call took. scripts/benchmark.py uses it to cost a guide.
UsageHook = Callable[[str, str, types.GenerateContentResponseUsageMetadata | None, float], None]


class GeminiLLM:
    """Calls the configured Gemini model with a JSON schema and validates the reply."""

    def __init__(
        self,
        settings: Settings | None = None,
        client: genai.Client | None = None,
        on_usage: UsageHook | None = None,
    ):
        self.settings = settings or get_settings()
        self._client = client
        self.on_usage = on_usage

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            self._client = get_genai_client()
        return self._client

    def generate(
        self,
        contents: types.ContentListUnion,
        schema: type[T],
        thinking: ThinkingLevel = "low",
        timeout_ms: int | None = None,
        hedge_after_s: float | None = None,
    ) -> T:
        """Generate a response that must match `schema`; raises if it does not.

        `timeout_ms` overrides the per-call timeout, e.g. for reading a long PDF.
        `hedge_after_s`: if no answer arrives in that time, send the same request again and
        use whichever answers first. The same request takes 8 s or 100 s on a bad minute.
        """
        if hedge_after_s:
            return _hedged(
                lambda: self._generate(contents, schema, thinking, timeout_ms), hedge_after_s
            )
        return self._generate(contents, schema, thinking, timeout_ms)

    def _generate(
        self,
        contents: types.ContentListUnion,
        schema: type[T],
        thinking: ThinkingLevel,
        timeout_ms: int | None,
    ) -> T:
        """Ask the main model; if it is still busy after its retries, ask the fallback once."""
        primary, fallback = self.settings.gemini_model, self.settings.gemini_fallback_model
        try:
            return self._call(primary, contents, schema, thinking, timeout_ms)
        except Exception as err:
            if not fallback or fallback == primary or not is_overloaded(err):
                raise
            log.warning("%s busy after retries (%s); answering with %s", primary, err, fallback)
            return self._call(fallback, contents, schema, thinking, timeout_ms)

    def _call(
        self,
        model: str,
        contents: types.ContentListUnion,
        schema: type[T],
        thinking: ThinkingLevel,
        timeout_ms: int | None,
    ) -> T:
        # Temperature is left at the default: Google advises against lowering it on
        # Gemini 3.x models (it can cause looping).
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
            thinking_config=types.ThinkingConfig(thinking_level=thinking.upper()),
            http_options=(
                types.HttpOptions(timeout=timeout_ms, retry_options=RETRY) if timeout_ms else None
            ),
        )
        start = time.perf_counter()
        response = self.client.models.generate_content(
            model=model, contents=contents, config=config
        )
        if self.on_usage:
            self.on_usage(
                schema.__name__, model, response.usage_metadata, time.perf_counter() - start
            )
        if not response.text:
            raise RuntimeError(f"Empty response from {model}")
        return schema.model_validate_json(response.text)


# Hedged requests run on their own pool so a slow call never blocks the caller's pool.
_hedge_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="gemini-hedge")
MAX_HEDGES = 2  # at most three copies of one request in flight


def _hedged(call, after_s: float):
    """Run `call`; each time `after_s` passes without an answer, start one more copy.

    Returns the first successful result. Raises the last error only if every copy failed.
    """
    pending: set[Future] = {_hedge_pool.submit(call)}
    started = 1
    error: BaseException | None = None
    while pending:
        done, pending = wait(pending, timeout=after_s, return_when=FIRST_COMPLETED)
        for future in done:
            if future.exception() is None:
                for other in pending:
                    other.cancel()
                return future.result()
            error = future.exception()
        if (not done or not pending) and started <= MAX_HEDGES:
            pending.add(_hedge_pool.submit(call))
            started += 1
    assert error is not None
    raise error
