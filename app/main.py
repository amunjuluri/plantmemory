"""FastAPI entry point: API routes plus the static UI."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import get_settings

VERSION = "0.1.0"

settings = get_settings()
app = FastAPI(title="PlantMemory", version=VERSION)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check with the active configuration (no secrets)."""
    return {
        "status": "ok",
        "version": VERSION,
        "store_backend": settings.store_backend,
        "gemini_model": settings.gemini_model,
        "embedding_model": settings.embedding_model,
        "auth": "vertexai" if settings.google_genai_use_vertexai else "api_key",
    }


# Mounted last so API routes take precedence.
app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="ui")
