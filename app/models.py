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


class DraftItem(BaseModel):
    """One suggested check or action, with the records that support it."""

    text: str
    citations: list[str] = Field(default_factory=list)
    general: bool = Field(
        default=False, description="True when this is general advice, not from past records."
    )


class Draft(BaseModel):
    """A troubleshooting note or investigation draft for a human to review."""

    incident: StructuredIncident
    summary: str
    similar_incidents: list[SimilarIncident] = Field(default_factory=list)
    recurrence_note: str | None = None
    suggested_checks: list[DraftItem] = Field(default_factory=list)
    suggested_actions: list[DraftItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list, description="All record ids cited.")
    status: Literal["draft", "approved"] = "draft"
    review_notice: str = "AI-generated draft. A qualified person must review before acting."
