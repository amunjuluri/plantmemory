"""Gemini client and a small structured-output helper shared by the agent and ingest."""

from functools import lru_cache
from typing import Literal, Protocol, TypeVar

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from app.config import Settings, get_settings

T = TypeVar("T", bound=BaseModel)
ThinkingLevel = Literal["low", "medium", "high"]  # "minimal" is rejected by gemini-3.8-flash

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


@lru_cache
def get_genai_client() -> genai.Client:
    """Return a google-genai client for Vertex AI or the Gemini API, per settings."""
    s = get_settings()
    if s.use_vertexai:
        return genai.Client(
            vertexai=True,
            project=s.google_cloud_project,
            location=s.google_cloud_location,
            http_options=types.HttpOptions(retry_options=RETRY, timeout=CALL_TIMEOUT_MS),
        )
    api_key = s.google_api_key.get_secret_value() if s.google_api_key else None
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(retry_options=RETRY, timeout=CALL_TIMEOUT_MS),
    )


class StructuredLLM(Protocol):
    """Anything that can turn a prompt into a validated Pydantic object."""

    def generate(
        self, contents: types.ContentListUnion, schema: type[T], thinking: ThinkingLevel = "low"
    ) -> T: ...


class GeminiLLM:
    """Calls the configured Gemini model with a JSON schema and validates the reply."""

    def __init__(self, settings: Settings | None = None, client: genai.Client | None = None):
        self.settings = settings or get_settings()
        self._client = client

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            self._client = get_genai_client()
        return self._client

    def generate(
        self, contents: types.ContentListUnion, schema: type[T], thinking: ThinkingLevel = "low"
    ) -> T:
        """Generate a response that must match `schema`; raises if it does not."""
        # Temperature is left at the default: Google advises against lowering it on
        # Gemini 3.x models (it can cause looping).
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
            thinking_config=types.ThinkingConfig(thinking_level=thinking.upper()),
        )
        response = self.client.models.generate_content(
            model=self.settings.gemini_model, contents=contents, config=config
        )
        if not response.text:
            raise RuntimeError(f"Empty response from {self.settings.gemini_model}")
        return schema.model_validate_json(response.text)
