"""Turn a human-approved draft into a new incident record, so memory grows with use."""

import uuid

from app.agent.guardrails import draft_citations
from app.agent.tools import AgentDeps
from app.embeddings import incident_text
from app.models import ApproveRequest, IncidentRecord


class UnknownCitationError(ValueError):
    """The approved draft cites record ids that are not in the store."""


def new_record_id(prefix: str = "APR") -> str:
    """A short unique id in the same PREFIX-SUFFIX form as seed records."""
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def approve_draft(request: ApproveRequest, deps: AgentDeps) -> IncidentRecord:
    """Validate, embed and store an approved draft as an `approved_draft` record."""
    draft = request.draft
    cited = draft_citations(draft)
    missing = [i for i in cited if deps.store.get(i) is None]
    if missing:
        raise UnknownCitationError(f"Draft cites records that do not exist: {missing}")

    incident = draft.incident
    planned = "; ".join(a.text for a in draft.suggested_actions)
    action = request.action_taken or incident.action_taken or (planned and f"Planned: {planned}")

    record = IncidentRecord(
        id=new_record_id(),
        industry=incident.industry,
        date=incident.date,
        area_or_equipment=incident.area_or_equipment,
        description=incident.description,
        suspected_cause=incident.suspected_cause,
        root_cause=request.root_cause or incident.root_cause,
        action_taken=action or None,
        outcome=request.outcome,
        downtime_minutes=request.downtime_minutes or incident.downtime_minutes,
        source="approved_draft",
        source_ref=", ".join(cited) or None,
    )
    record.embedding = deps.embedder.embed_documents([incident_text(record)])[0]
    deps.store.upsert([record])
    return record
