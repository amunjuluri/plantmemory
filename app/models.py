"""Pydantic models shared by the API, agent and stores."""

from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Industry = Literal["paper", "pharma", "generic"]
Outcome = Literal["resolved", "recurred", "unknown"]
Source = Literal["seed", "logbook_photo", "voice_note", "approved_draft"]


def _now() -> datetime:
    return datetime.now(UTC)


class IncidentCore(BaseModel):
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


class SimilarIncident(BaseModel):
    """A past incident returned by search, with why it matches."""

    id: str
    score: float = Field(ge=-1.0, le=1.0)
    why: str = ""
    record: IncidentPublic | None = None


class Recurrence(BaseModel):
    """How often this kind of incident has happened before, worked out in code."""

    window_months: int
    in_window: list[str] = Field(
        default_factory=list, description="Similar records dated within the window."
    )
    recurred: list[str] = Field(
        default_factory=list, description="Similar records whose fix did not hold."
    )
    is_repeat: bool = False
    note: str | None = None


class DraftItem(BaseModel):
    """One suggested check or action, with the records that support it."""

    text: str
    citations: list[str] = Field(default_factory=list)
    general: bool = Field(
        default=False, description="True when this is general advice, not from past records."
    )


class MatchExplanation(BaseModel):
    """The model's one-line reason a past record matches the new incident."""

    id: str
    why: str


class DraftContent(BaseModel):
    """The part of a draft the model writes. Code checks it and builds the `Draft`."""

    summary: str
    match_explanations: list[MatchExplanation] = Field(default_factory=list)
    suggested_checks: list[DraftItem] = Field(default_factory=list)
    suggested_actions: list[DraftItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


REVIEW_NOTICE = "AI-generated draft. A qualified person must review it before anyone acts on it."


class Draft(BaseModel):
    """A troubleshooting note or investigation draft for a human to review."""

    incident: StructuredIncident
    summary: str
    no_match: bool = Field(default=False, description="True when no past incident was similar.")
    similar_incidents: list[SimilarIncident] = Field(default_factory=list)
    recurrence_note: str | None = None
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


class AnalyzeRequest(BaseModel):
    """A new incident described in free text."""

    text: str = Field(min_length=5, max_length=8000)
    industry: Industry | None = Field(
        default=None, description="Restrict search to one industry. Omit to search all."
    )


class ApproveRequest(BaseModel):
    """A reviewed (possibly edited) draft, plus what was actually found and done."""

    draft: Draft
    root_cause: str | None = None
    action_taken: str | None = None
    outcome: Outcome = "unknown"
    downtime_minutes: int | None = Field(default=None, ge=0)


class IncidentPage(BaseModel):
    """One page of incident records."""

    items: list[IncidentPublic]
    total: int
    offset: int
    limit: int
