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
    # Spoken conversations (voice reports). On Vertex AI the Live models are served from
    # a few regions only, not "global"; us-central1 has gemini-3.8-live.
    live_model: str = "gemini-3.8-live"
    live_location: str = "us-central1"
    live_voice: str = "Aoede"
    embedding_dim: int = 768

    # Storage.
    store_backend: Literal["local", "firestore"] = "local"
    local_store_path: Path = ROOT_DIR / "data" / "store" / "incidents.json"
    firestore_database: str = "(default)"
    firestore_collection: str = "incidents"
    # Manuals, error codes, parts, figures and repair guides: one collection (or local
    # JSON file) each, named "<prefix><kind>", e.g. "manual_sections".
    kb_collection_prefix: str = ""
    local_kb_dir: Path = ROOT_DIR / "data" / "store"

    # Retrieval and agent behaviour.
    # Search results scoring at least this are candidates; Gemini then checks each one
    # is the same problem (see tools.verify_matches and scripts/eval_retrieval.py).
    match_threshold: float = 0.70
    draft_thinking_level: Literal["low", "medium", "high"] = "low"
    # Detail Gemini reads logbook photos at: MEDIA_RESOLUTION_{LOW,MEDIUM,HIGH,ULTRA_HIGH}.
    ocr_media_resolution: str = "MEDIA_RESOLUTION_HIGH"
    recurrence_window_months: int = 12
    # Manual sections scoring at least this against a breakdown report are offered to
    # the guide writer (see scripts/eval_retrieval.py and DECISIONS.md).
    manual_threshold: float = 0.62
    # Languages the printed repair guide is translated into, as ISO 639-1 codes. English
    # is always printed too. Change here (or GUIDE_LANGUAGES='["ta"]') with no code change.
    guide_languages: list[str] = ["te", "hi"]
    # Who approves a repair guide before it is printed. "when_needed": the manager, unless
    # code finds a reason QA must (a flagged value, a step with no source, a translation
    # that may not match, an earlier rejection). "always": QA approves every guide.
    qa_approval: Literal["when_needed", "always"] = "when_needed"
    default_industry: Literal["paper", "pharma", "generic"] = "generic"

    # Per-client cap on requests that call Gemini (analyze, guides, uploads). 0 disables.
    ai_requests_per_hour: int = 40

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
