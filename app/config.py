"""Application settings, read from environment variables and `.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent

# The google-genai SDK and ADK read GOOGLE_* variables straight from the process
# environment, so load `.env` into os.environ as well as into Settings.
load_dotenv(ROOT_DIR / ".env", override=False)


class Settings(BaseSettings):
    """All runtime configuration. Field names map to upper-case env vars."""

    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # Google AI auth: Vertex AI (ADC) when true, otherwise a Gemini API key.
    # GOOGLE_GENAI_USE_ENTERPRISE replaces the deprecated GOOGLE_GENAI_USE_VERTEXAI;
    # both are accepted here and by the google-genai SDK and ADK.
    use_vertexai: bool = Field(
        default=False,
        validation_alias=AliasChoices("GOOGLE_GENAI_USE_ENTERPRISE", "GOOGLE_GENAI_USE_VERTEXAI"),
    )
    google_cloud_project: str | None = None
    google_cloud_location: str = "global"
    google_api_key: SecretStr | None = None

    # Models. Defaults follow current Google docs; override per environment.
    gemini_model: str = "gemini-3.8-flash"
    embedding_model: str = "gemini-embedding-2"
    embedding_dim: int = 768

    # Storage.
    store_backend: Literal["local", "firestore"] = "local"
    local_store_path: Path = ROOT_DIR / "data" / "store" / "incidents.json"
    firestore_database: str = "(default)"
    firestore_collection: str = "incidents"

    # Retrieval and agent behaviour.
    match_threshold: float = 0.70  # calibrated with scripts/eval_retrieval.py
    # A match must also score within this margin of the best match to count as the
    # same problem (rather than merely the same machine). Calibrated on the eval set.
    match_margin: float = 0.06
    draft_thinking_level: Literal["low", "medium", "high"] = "low"
    # Detail Gemini reads logbook photos at: MEDIA_RESOLUTION_{LOW,MEDIUM,HIGH,ULTRA_HIGH}.
    ocr_media_resolution: str = "MEDIA_RESOLUTION_HIGH"
    recurrence_window_months: int = 12
    default_industry: Literal["paper", "pharma", "generic"] = "generic"

    # Origins allowed to call the API from another port (local UI dev only), e.g.
    # CORS_ORIGINS='["http://localhost:3473"]'. Empty in production: same origin.
    cors_origins: list[str] = []

    # Built frontend (Next.js static export). Falls back to app/static.
    web_dist_dir: Path = ROOT_DIR / "web" / "out"

    @property
    def static_dir(self) -> Path:
        """Directory the UI is served from."""
        if (self.web_dist_dir / "index.html").exists():
            return self.web_dist_dir
        return ROOT_DIR / "app" / "static"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
