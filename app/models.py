"""Pydantic models shared by the API, agent and stores."""

import datetime as dt
from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Industry = Literal["paper", "pharma", "generic"]
Outcome = Literal["resolved", "recurred", "unknown"]
Source = Literal["seed", "logbook_photo", "voice_note", "approved_draft"]


class Model(BaseModel):
    """Base for every API model. Response schemas mark defaulted fields as always present."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


def _now() -> datetime:
    return datetime.now(UTC)


class IncidentCore(Model):
    """Fields that describe an incident, whether new or historical."""

    industry: Industry = "generic"
    date: date
    area_or_equipment: str
    description: str = Field(description="Free text, as originally written.")
    suspected_cause: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    downtime_minutes: int | None = Field(default=None, ge=0)


class StructuredIncident(IncidentCore):
    """A new incident as understood by the agent. No outcome yet."""


class IncidentPublic(IncidentCore):
    """An incident record as returned to clients (no embedding)."""

    id: str
    outcome: Outcome = "unknown"
    source: Source = "seed"
    source_ref: str | None = None
    confidence_flags: list[str] = Field(
        default_factory=list, description="Fields the AI was unsure about."
    )
    created_at: datetime = Field(default_factory=_now)


class IncidentRecord(IncidentPublic):
    """An incident record as stored, including its embedding vector."""

    embedding: list[float] | None = Field(default=None, repr=False)


class SimilarIncident(Model):
    """A past incident returned by search, with why it matches."""

    id: str
    score: float = Field(ge=-1.0, le=1.0)
    why: str = ""
    record: IncidentPublic | None = None


class Recurrence(Model):
    """How often this kind of incident has happened before, worked out in code."""

    window_months: int
    in_window: list[str] = Field(
        default_factory=list, description="Similar records dated within the window."
    )
    recurred: list[str] = Field(
        default_factory=list, description="Similar records whose fix did not hold."
    )
    is_repeat: bool = False
    occurrence: int = Field(
        default=1, description="Which time this is within the window: 3 means third time."
    )
    downtime_minutes: int = Field(
        default=0, description="Downtime recorded for the similar incidents in the window."
    )
    downtime_records: int = Field(
        default=0, description="How many of those incidents recorded a downtime."
    )
    note: str | None = None


class DraftItem(Model):
    """One suggested check or action, with the records that support it."""

    text: str
    citations: list[str] = Field(default_factory=list)
    general: bool = Field(
        default=False, description="True when this is general advice, not from past records."
    )


class MatchExplanation(Model):
    """The model's one-line reason a past record matches the new incident."""

    id: str
    why: str


class MatchVerdict(Model):
    """The model's judgement of one search candidate."""

    id: str
    same_problem: bool
    why: str = Field(description="One sentence: the shared problem, or the key difference.")


class MatchCheck(Model):
    """The model's judgement of every search candidate. Code decides what to keep."""

    verdicts: list[MatchVerdict]


class DraftContent(Model):
    """The part of a draft the model writes. Code checks it and builds the `Draft`."""

    summary: str
    match_explanations: list[MatchExplanation] = Field(default_factory=list)
    suggested_checks: list[DraftItem] = Field(default_factory=list)
    suggested_actions: list[DraftItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


REVIEW_NOTICE = "AI-generated draft. A qualified person must review it before anyone acts on it."


class Draft(Model):
    """A troubleshooting note or investigation draft for a human to review."""

    incident: StructuredIncident
    summary: str
    no_match: bool = Field(default=False, description="True when no past incident was similar.")
    similar_incidents: list[SimilarIncident] = Field(default_factory=list)
    recurrence_note: str | None = None
    recurrence: Recurrence | None = Field(
        default=None, description="Counts behind recurrence_note, for the UI."
    )
    suggested_checks: list[DraftItem] = Field(default_factory=list)
    suggested_actions: list[DraftItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    cause_flags: list[str] = Field(
        default_factory=list, description="Shallow causes (e.g. 'operator error') to dig into."
    )
    citations: list[str] = Field(default_factory=list, description="All record ids cited.")
    status: Literal["draft", "approved"] = "draft"
    review_notice: str = REVIEW_NOTICE


# --- API request/response bodies ---


class AnalyzeRequest(Model):
    """A new incident described in free text."""

    text: str = Field(min_length=5, max_length=8000)
    industry: Industry | None = Field(
        default=None, description="Restrict search to one industry. Omit to search all."
    )


class ApproveRequest(Model):
    """A reviewed (possibly edited) draft, plus what was actually found and done."""

    draft: Draft
    root_cause: str | None = None
    action_taken: str | None = None
    outcome: Outcome = "unknown"
    downtime_minutes: int | None = Field(default=None, ge=0)


class IncidentPage(Model):
    """One page of incident records."""

    items: list[IncidentPublic]
    total: int
    offset: int
    limit: int


# --- Logbook ingest ---


class ExtractedIncident(Model):
    """One logbook entry as read by the model from a photo."""

    industry: Industry = "generic"
    date: dt.date | None = Field(default=None, description="Null if no date is readable.")
    area_or_equipment: str
    description: str
    suspected_cause: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    outcome: Outcome = "unknown"
    downtime_minutes: int | None = Field(default=None, ge=0)
    confidence_flags: list[str] = Field(
        default_factory=list, description="Names of fields that were hard to read or unsure."
    )


class LogbookExtraction(Model):
    """Everything the model read from one logbook page."""

    records: list[ExtractedIncident] = Field(default_factory=list)
    page_notes: str | None = Field(
        default=None, description="Anything a reviewer should know, e.g. a torn corner."
    )


class IngestResult(Model):
    """Records read from a photo, not yet saved. A person reviews, then confirms."""

    source_ref: str
    records: list[IncidentPublic]
    page_notes: str | None = None
    glossary_terms: int = Field(default=0, description="Glossary entries given to the model.")


class ConfirmRequest(Model):
    """Reviewed (possibly edited) records from /api/ingest/logbook, to be saved."""

    records: list[IncidentPublic] = Field(min_length=1, max_length=50)
