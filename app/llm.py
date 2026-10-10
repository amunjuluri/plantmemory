"""Gemini client and a small structured-output helper shared by the agent and ingest."""

from functools import lru_cache
from typing import Literal, Protocol, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.config import Settings, get_settings

T = TypeVar("T", bound=BaseModel)
ThinkingLevel = Literal["low", "medium", "high"]  # "minimal" is rejected by gemini-3.8-flash


@lru_cache
def get_genai_client() -> genai.Client:
    """Return a google-genai client for Vertex AI or the Gemini API, per settings."""
    s = get_settings()
    if s.use_vertexai:
        return genai.Client(
            vertexai=True, project=s.google_cloud_project, location=s.google_cloud_location
        )
    api_key = s.google_api_key.get_secret_value() if s.google_api_key else None
    return genai.Client(api_key=api_key)


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
