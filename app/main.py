"""FastAPI entry point: API routes plus the static UI."""

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.sse import EventSourceResponse
from fastapi.staticfiles import StaticFiles

from app.agent import agent
from app.agent.tools import get_deps
from app.approval import UnknownCitationError, approve_draft
from app.config import ROOT_DIR, get_settings
from app.ingest import logbook_ocr
from app.models import (
    AnalyzeRequest,
    ApproveRequest,
    ConfirmRequest,
    Draft,
    IncidentPage,
    IncidentPublic,
    Industry,
    IngestResult,
)

VERSION = "0.1.0"

settings = get_settings()
app = FastAPI(title="PlantMemory", version=VERSION)
if settings.cors_origins:
    # Only for local UI development (Next.js dev server on another port).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )


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


@app.post("/api/ingest/logbook")
async def ingest_logbook(
    file: Annotated[UploadFile, File(description="Photo of a logbook page")],
    industry: Annotated[Industry | None, Form()] = None,
) -> IngestResult:
    """Read incidents from a logbook photo for review. Nothing is saved yet."""
    image = await file.read(logbook_ocr.MAX_IMAGE_BYTES + 1)
    try:
        return await asyncio.to_thread(
            logbook_ocr.extract_records, image, file.filename, get_deps(), industry
        )
    except logbook_ocr.InvalidImageError as err:
        raise HTTPException(status_code=415, detail=str(err)) from err


@app.post("/api/ingest/confirm", status_code=201)
def confirm_logbook(body: ConfirmRequest) -> list[IncidentPublic]:
    """Save reviewed logbook records so future searches can find them."""
    try:
        saved = logbook_ocr.confirm_records(body.records, get_deps())
    except logbook_ocr.ConfirmError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    return [_public(r) for r in saved]


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


@app.get("/api/incidents/{record_id}")
def get_incident(record_id: str) -> IncidentPublic:
    """One stored incident by id."""
    record = get_deps().store.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No incident {record_id}")
    return _public(record)


# Synthetic sample photos, so the UI can offer "try a sample page".
app.mount("/samples", StaticFiles(directory=ROOT_DIR / "data" / "samples"), name="samples")
# Mounted last so API routes take precedence.
app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="ui")
