"""FastAPI entry point: API routes plus the static UI."""

import asyncio
import base64
import contextlib
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.sse import EventSourceResponse
from fastapi.staticfiles import StaticFiles
from google.genai import errors as genai_errors
from pydantic import ValidationError

from app.agent import agent
from app.agent.tools import get_deps
from app.approval import UnknownCitationError, approve_draft
from app.config import ROOT_DIR, get_settings
from app.guide import workflow
from app.guide.builder import build_guide_events
from app.guide.translate import language_name
from app.ingest import logbook_ocr
from app.intake import cmms, live, machine_logs, voice
from app.kb import get_kb, manual_ingest
from app.kb.loader import list_assets, summarize_manuals
from app.llm import BUSY_MESSAGE, get_live_client, is_overloaded
from app.models import (
    RELEASE_CHECKS,
    AnalyzeRequest,
    ApproveRequest,
    Asset,
    CmmsImportResult,
    ConfirmRequest,
    Draft,
    Guide,
    GuideAction,
    GuideClose,
    GuideEdit,
    GuideProgress,
    GuideRelease,
    GuideRequest,
    GuideReview,
    GuideStatus,
    GuideSummary,
    IncidentPage,
    IncidentPublic,
    Industry,
    IngestResult,
    IntakeMode,
    IntakeState,
    IntakeTurnResult,
    LogAnalysis,
    ManualSectionPublic,
    ManualSummary,
    ManualUploadResult,
    Model,
    Part,
)
from app.ratelimit import client_id, limit_ai_calls, limiter

VERSION = "0.2.0"

settings = get_settings()
app = FastAPI(title="PlantMemory", version=VERSION)
if settings.cors_origins:
    # Only for local UI development (Next.js dev server on another port).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["content-type"],
    )


@app.exception_handler(genai_errors.APIError)
async def gemini_error(request: Request, err: genai_errors.APIError) -> JSONResponse:
    """Gemini still failing after retries: say so plainly instead of a bare 500."""
    if is_overloaded(err):
        return JSONResponse(
            {"detail": BUSY_MESSAGE}, status_code=503, headers={"Retry-After": "30"}
        )
    return JSONResponse({"detail": "The AI service returned an error."}, status_code=502)


@app.exception_handler(workflow.GuideError)
async def guide_error(request: Request, err: workflow.GuideError) -> JSONResponse:
    return JSONResponse({"detail": str(err)}, status_code=err.status_code)


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


@app.post("/api/incidents/analyze", dependencies=[Depends(limit_ai_calls)])
async def analyze_incident(body: AnalyzeRequest) -> Draft:
    """Find similar past incidents and draft a cited note. A human must review it."""
    try:
        return await agent.analyze(body.text, body.industry)
    except agent.AgentError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@app.post(
    "/api/incidents/analyze/stream",
    response_class=EventSourceResponse,
    dependencies=[Depends(limit_ai_calls)],
)
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


@app.post("/api/ingest/logbook", dependencies=[Depends(limit_ai_calls)])
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
    """Save reviewed logbook or CMMS records so future searches can find them."""
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


# --- Knowledge base: manuals, parts, figures ---


class LanguageOption(Model):
    code: str
    name: str


class AppConfig(Model):
    """What the UI needs to know about this deployment."""

    guide_languages: list[LanguageOption]
    store_backend: str
    qa_approval: str
    release_checks: list[str]


@app.get("/api/config")
def app_config() -> AppConfig:
    return AppConfig(
        guide_languages=[
            LanguageOption(code=c, name=language_name(c)) for c in settings.guide_languages
        ],
        store_backend=settings.store_backend,
        qa_approval=settings.qa_approval,
        release_checks=list(RELEASE_CHECKS),
    )


@app.get("/api/assets")
def assets() -> list[Asset]:
    """Machines the plant has manuals or spare parts for."""
    return list_assets(get_kb())


@app.get("/api/manuals")
def manuals() -> list[ManualSummary]:
    return summarize_manuals(get_kb())


def _section_public(section) -> ManualSectionPublic:
    return ManualSectionPublic.model_validate(section.model_dump(exclude={"embedding"}))


@app.get("/api/manuals/sections/{section_id}")
def manual_section(section_id: str) -> ManualSectionPublic:
    section = get_kb().sections.get(section_id)
    if section is None:
        raise HTTPException(status_code=404, detail=f"No manual section {section_id}")
    return _section_public(section)


@app.get("/api/manuals/{manual_id}/sections")
def manual_sections(manual_id: str) -> list[ManualSectionPublic]:
    sections = get_kb().sections.all(manual_id=manual_id)
    return [_section_public(s) for s in sorted(sections, key=lambda s: s.page)]


@app.post("/api/manuals/upload", status_code=201, dependencies=[Depends(limit_ai_calls)])
async def upload_manual(
    file: Annotated[UploadFile, File(description="Equipment manual as a PDF")],
    asset_tags: Annotated[
        str | None, Form(description="Machines it covers, e.g. TP-01, TP-02")
    ] = None,
) -> ManualUploadResult:
    """Read a manual so guides can cite it by page. Replaces an earlier upload of it."""
    data = await file.read(manual_ingest.MAX_PDF_BYTES + 1)
    try:
        return await asyncio.to_thread(
            manual_ingest.ingest_manual,
            data,
            file.filename,
            manual_ingest.parse_tags(asset_tags),
            get_deps(),
            get_kb(),
        )
    except manual_ingest.InvalidManualError as err:
        raise HTTPException(status_code=415, detail=str(err)) from err


@app.delete("/api/manuals/{manual_id}")
def delete_manual(manual_id: str) -> dict[str, int]:
    removed = manual_ingest.delete_manual(manual_id, get_kb())
    if not removed:
        raise HTTPException(status_code=404, detail=f"No manual {manual_id}")
    return {"sections_removed": removed}


@app.get("/api/parts")
def parts(asset: str | None = Query(None, max_length=40)) -> list[Part]:
    """Spare parts and stock, optionally for one machine."""
    kb = get_kb()
    found = kb.parts.all(asset_tags=asset) if asset else kb.parts.all()
    return sorted(found, key=lambda p: p.part_no)


@app.get("/api/figures/{figure_id}")
def figure(figure_id: str) -> Response:
    """A manual figure or part photo. Figures never change once stored."""
    found = get_kb().figures.get(figure_id)
    if found is None:
        raise HTTPException(status_code=404, detail=f"No figure {figure_id}")
    return Response(
        base64.b64decode(found.data_b64),
        media_type=found.mime,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# --- Repair guides ---


@app.post(
    "/api/guides/stream",
    response_class=EventSourceResponse,
    dependencies=[Depends(limit_ai_calls)],
)
async def draft_guide(body: GuideRequest) -> AsyncIterator[GuideProgress]:
    """Draft a repair guide, streamed as server-sent events: each step, then the guide."""
    async for update in build_guide_events(body, get_deps(), get_kb()):
        yield update


@app.get("/api/guides")
def guides(status: GuideStatus | None = None) -> list[GuideSummary]:
    return workflow.list_guides(get_kb(), status)


@app.get("/api/guides/{guide_id}")
def guide(guide_id: str) -> Guide:
    return workflow.load(guide_id, get_kb())


@app.put("/api/guides/{guide_id}")
def edit_guide(guide_id: str, body: GuideEdit) -> Guide:
    """Save the manager's edits. Sources, values, figures and parts are re-checked."""
    return workflow.edit(guide_id, body, get_kb())


@app.post("/api/guides/{guide_id}/submit", dependencies=[Depends(limit_ai_calls)])
async def submit_guide(guide_id: str, body: GuideAction) -> Guide:
    """Translate the guide into the shop-floor languages and send it to QA."""
    return await asyncio.to_thread(workflow.submit, guide_id, body, get_deps(), get_kb())


@app.post("/api/guides/{guide_id}/approve", dependencies=[Depends(limit_ai_calls)])
async def approve_guide(guide_id: str, body: GuideAction) -> Guide:
    """The manager approves the guide they checked; it goes to QA instead if code finds a
    reason QA must approve (the reasons are in `qa_reasons`)."""
    return await asyncio.to_thread(workflow.approve, guide_id, body, get_deps(), get_kb())


@app.post("/api/guides/{guide_id}/review")
def review_guide(guide_id: str, body: GuideReview) -> Guide:
    """QA approves the guide for printing, or rejects it with a reason."""
    return workflow.review(guide_id, body, get_kb())


@app.post("/api/guides/{guide_id}/print")
def print_guide(guide_id: str, body: GuideAction) -> Guide:
    """Count a printed copy of an approved guide."""
    return workflow.record_print(guide_id, body, get_kb())


@app.post("/api/guides/{guide_id}/close")
async def close_guide(guide_id: str, body: GuideClose) -> Guide:
    """Record what was actually done; it is saved to plant memory."""
    return await asyncio.to_thread(workflow.close, guide_id, body, get_deps(), get_kb())


@app.post("/api/guides/{guide_id}/release")
def release_guide(guide_id: str, body: GuideRelease) -> Guide:
    """QA's line clearance after the repair: the machine may go back to production."""
    return workflow.release(guide_id, body, get_kb())


# --- Easier input: voice, machine logs, CMMS exports ---


def _same_origin(ws: WebSocket) -> bool:
    """Browsers send Origin on WebSockets; only this site (or the dev UI) may open one."""
    origin = ws.headers.get("origin")
    if not origin:
        return True
    host = origin.split("://", 1)[-1]
    return host == ws.headers.get("host") or origin in settings.cors_origins


@app.websocket("/api/intake/live")
async def intake_live(
    ws: WebSocket, mode: IntakeMode = "breakdown", guide_id: str | None = None
) -> None:
    """A spoken conversation on Gemini Live that fills a breakdown report or a closure.

    The browser sends 16 kHz PCM audio; replies come back as 24 kHz PCM and JSON events
    (see app/intake/live.py).
    """
    await ws.accept()
    reason = None
    if not _same_origin(ws):
        reason = "Voice is only available on this site."
    else:
        try:
            limiter.check(client_id(ws))
        except HTTPException as err:
            reason = str(err.detail)
    kb = get_kb()
    guide = None
    if not reason and guide_id:
        try:
            guide = workflow.load(guide_id, kb)
        except workflow.GuideError as err:
            reason = str(err)
    if reason:
        await ws.send_json({"type": "error", "message": reason})
        await ws.close(code=1008)
        return
    session = live.LiveSession(mode=mode, assets=list_assets(kb), guide=guide)
    codes = list(dict.fromkeys(c.code for c in kb.codes.all()))
    await live.run(ws, session, get_live_client(), settings, codes)
    with contextlib.suppress(RuntimeError):  # already closed by the browser
        await ws.close()


@app.post("/api/intake/turn", dependencies=[Depends(limit_ai_calls)])
async def intake_turn(
    state: Annotated[str, Form(description="The IntakeState from the previous turn, as JSON")],
    audio: Annotated[UploadFile | None, File(description="Voice recording")] = None,
    text: Annotated[str | None, Form(max_length=4000)] = None,
) -> IntakeTurnResult:
    """One turn of the spoken report: hear it, fill fields, ask for what is missing."""
    try:
        current = IntakeState.model_validate_json(state)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail="Invalid conversation state.") from err
    data = await audio.read(voice.MAX_AUDIO_BYTES + 1) if audio else None
    try:
        return await asyncio.to_thread(
            voice.take_turn, current, get_deps(), list_assets(get_kb()), data or None, text
        )
    except voice.InvalidAudioError as err:
        raise HTTPException(status_code=415, detail=str(err)) from err


@app.post("/api/logs/analyze", dependencies=[Depends(limit_ai_calls)])
async def analyze_log(
    file: Annotated[UploadFile, File(description="Machine or instrument log (CSV or text)")],
    asset_tag: Annotated[str | None, Form(max_length=40)] = None,
) -> LogAnalysis:
    """Split a log into errors and warnings, with manual first actions and time estimates."""
    data = await file.read(machine_logs.MAX_LOG_BYTES + 1)
    try:
        return await asyncio.to_thread(
            machine_logs.analyze_log, data, file.filename, get_deps(), get_kb(), asset_tag
        )
    except machine_logs.InvalidLogError as err:
        raise HTTPException(status_code=415, detail=str(err)) from err


@app.post("/api/ingest/cmms", dependencies=[Depends(limit_ai_calls)])
async def ingest_cmms(
    file: Annotated[UploadFile, File(description="CMMS export: CSV or Excel")],
    industry: Annotated[Industry | None, Form()] = None,
) -> CmmsImportResult:
    """Read maintenance history from a CMMS export for review. Nothing is saved yet."""
    data = await file.read(cmms.MAX_BYTES + 1)
    try:
        return await asyncio.to_thread(
            cmms.import_export, data, file.filename, get_deps(), industry
        )
    except cmms.InvalidExportError as err:
        raise HTTPException(status_code=415, detail=str(err)) from err


# Synthetic samples (logbook photos, logs, CMMS export, a manual) for the UI's "try a sample".
app.mount("/samples", StaticFiles(directory=ROOT_DIR / "data" / "samples"), name="samples")
# Mounted last so API routes take precedence.
app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="ui")
