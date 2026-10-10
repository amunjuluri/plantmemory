"""FastAPI entry point: API routes plus the static UI."""

from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.sse import EventSourceResponse
from fastapi.staticfiles import StaticFiles

from app.agent import agent
from app.agent.tools import get_deps
from app.approval import UnknownCitationError, approve_draft
from app.config import get_settings
from app.models import (
    AnalyzeRequest,
    ApproveRequest,
    Draft,
    IncidentPage,
    IncidentPublic,
    Industry,
)

VERSION = "0.1.0"

settings = get_settings()
app = FastAPI(title="PlantMemory", version=VERSION)


def _public(record) -> IncidentPublic:
    return IncidentPublic.model_validate(record.model_dump(exclude={"embedding"}))


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check with the active configuration (no secrets)."""
    return {
        "status": "ok",
        "version": VERSION,
        "store_backend": settings.store_backend,
        "gemini_model": settings.gemini_model,
        "embedding_model": settings.embedding_model,
        "auth": "vertexai" if settings.use_vertexai else "api_key",
    }


@app.post("/api/incidents/analyze")
async def analyze_incident(body: AnalyzeRequest) -> Draft:
    """Find similar past incidents and draft a cited note. A human must review it."""
    try:
        return await agent.analyze(body.text, body.industry)
    except agent.AgentError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@app.post("/api/incidents/analyze/stream", response_class=EventSourceResponse)
async def analyze_incident_stream(body: AnalyzeRequest) -> AsyncIterator[agent.Progress]:
    """Same as /analyze, streamed as server-sent events: each step, then the draft."""
    async for update in agent.analyze_events(body.text, body.industry):
        yield update


@app.post("/api/incidents/approve", status_code=201)
def approve_incident(body: ApproveRequest) -> IncidentPublic:
    """Save a reviewed draft as a new incident record so future searches can find it."""
    try:
        record = approve_draft(body, get_deps())
    except UnknownCitationError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    return _public(record)


@app.get("/api/incidents")
def list_incidents(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    industry: Industry | None = None,
) -> IncidentPage:
    """List stored incidents, newest first."""
    store = get_deps().store
    return IncidentPage(
        items=[_public(r) for r in store.list_records(offset, limit, industry)],
        total=store.count(industry),
        offset=offset,
        limit=limit,
    )


# Mounted last so API routes take precedence.
app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="ui")
