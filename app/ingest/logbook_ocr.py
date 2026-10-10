"""Photo of a logbook page -> incident records for a person to review, then save."""

import json
import re
import uuid
from datetime import date
from functools import lru_cache
from pathlib import Path

from google.genai import types

from app.agent import prompts
from app.agent.tools import AgentDeps
from app.config import ROOT_DIR
from app.embeddings import incident_text
from app.models import (
    ExtractedIncident,
    IncidentPublic,
    IncidentRecord,
    Industry,
    IngestResult,
    LogbookExtraction,
)

GLOSSARY_DIR = ROOT_DIR / "data" / "glossary"
MAX_IMAGE_BYTES = 15 * 1024 * 1024  # Gemini's inline request limit is 20 MB in total.
LOG_ID_PREFIX = "LOG"

# Fields a reviewer can be asked to check. Anything else the model flags is dropped.
FLAGGABLE_FIELDS = {
    "date",
    "area_or_equipment",
    "description",
    "suspected_cause",
    "root_cause",
    "action_taken",
    "outcome",
    "downtime_minutes",
    "industry",
}
_UNREADABLE = "[?]"


class InvalidImageError(ValueError):
    """The upload is not a supported image, or is too large."""


class ConfirmError(ValueError):
    """Records sent to /confirm did not come from a logbook extraction."""


def sniff_image_type(data: bytes) -> str:
    """Return the image MIME type from the file's first bytes, or raise InvalidImageError."""
    if len(data) > MAX_IMAGE_BYTES:
        raise InvalidImageError(f"Image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB.")
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in {b"heic", b"heix", b"heim", b"heis"}:
            return "image/heic"
        if brand in {b"mif1", b"msf1", b"heif"}:
            return "image/heif"
    raise InvalidImageError("Upload a photo in JPEG, PNG, WebP or HEIC format.")


@lru_cache
def _read_glossary_file(path: Path) -> dict[str, str]:
    return {str(k): str(v) for k, v in json.loads(path.read_text()).items()}


def load_glossary(
    industry: Industry | None = None, directory: Path = GLOSSARY_DIR
) -> dict[str, str]:
    """Merge generic.json with the industry's file, or with every file if no industry."""
    if not directory.exists():
        return {}
    files = sorted(directory.glob("*.json"))
    if industry:
        files = [f for f in files if f.stem in {"generic", industry}]
    glossary: dict[str, str] = {}
    for path in files:
        glossary.update(_read_glossary_file(path))
    return glossary


def _format_glossary(glossary: dict[str, str]) -> str:
    if not glossary:
        return prompts.NO_GLOSSARY
    return "\n".join(f"- {abbr}: {meaning}" for abbr, meaning in sorted(glossary.items()))


def _safe_filename(name: str | None) -> str:
    base = Path(name or "logbook-photo").name
    return re.sub(r"[^\w.\- ]", "_", base)[:120] or "logbook-photo"


def new_log_id() -> str:
    """A unique id for a record read from a logbook photo."""
    return f"{LOG_ID_PREFIX}-{uuid.uuid4().hex[:8].upper()}"


def _to_record(
    entry: ExtractedIncident, source_ref: str, industry: Industry | None, today: date
) -> IncidentPublic:
    flags = [f for f in entry.confidence_flags if f in FLAGGABLE_FIELDS]
    if entry.date is None:
        flags.append("date")  # filled with today; the reviewer must correct it
    for field in ("area_or_equipment", "description", "suspected_cause", "root_cause"):
        value = getattr(entry, field)
        if value and _UNREADABLE in value:
            flags.append(field)
    return IncidentPublic(
        id=new_log_id(),
        industry=industry or entry.industry,
        date=entry.date or today,
        area_or_equipment=entry.area_or_equipment,
        description=entry.description,
        suspected_cause=entry.suspected_cause,
        root_cause=entry.root_cause,
        action_taken=entry.action_taken,
        outcome=entry.outcome,
        downtime_minutes=entry.downtime_minutes,
        source="logbook_photo",
        source_ref=source_ref,
        confidence_flags=list(dict.fromkeys(flags)),
    )


def extract_records(
    image: bytes,
    filename: str | None,
    deps: AgentDeps,
    industry: Industry | None = None,
    today: date | None = None,
) -> IngestResult:
    """Read every incident on a logbook photo. Nothing is saved until confirmed."""
    mime_type = sniff_image_type(image)
    today = today or date.today()
    glossary = load_glossary(industry)
    rule = prompts.INDUSTRY_FIXED.format(industry=industry) if industry else prompts.INDUSTRY_INFER
    prompt = prompts.LOGBOOK_PROMPT.format(
        year=today.year, industry_rule=rule, glossary=_format_glossary(glossary)
    )
    photo = types.Part.from_bytes(
        data=image, mime_type=mime_type, media_resolution=deps.settings.ocr_media_resolution
    )
    extraction = deps.llm.generate([photo, prompt], LogbookExtraction, thinking="low")

    source_ref = _safe_filename(filename)
    return IngestResult(
        source_ref=source_ref,
        records=[_to_record(e, source_ref, industry, today) for e in extraction.records],
        page_notes=extraction.page_notes,
        glossary_terms=len(glossary),
    )


def confirm_records(records: list[IncidentPublic], deps: AgentDeps) -> list[IncidentRecord]:
    """Embed and save reviewed logbook records. Re-confirming the same ids updates them."""
    bad = [r.id for r in records if not r.id.startswith(f"{LOG_ID_PREFIX}-")]
    if bad:
        raise ConfirmError(f"Only records from a logbook photo can be confirmed here: {bad}")
    stored = [
        IncidentRecord(**r.model_dump(exclude={"source"}), source="logbook_photo") for r in records
    ]
    vectors = deps.embedder.embed_documents([incident_text(r) for r in stored])
    for record, vector in zip(stored, vectors, strict=True):
        record.embedding = vector
    deps.store.upsert(stored)
    return stored
