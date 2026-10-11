"""A guide's life: draft -> in review (translated) -> approved or rejected -> printed -> closed.

Rules enforced here, not in the UI:
- Only drafts and rejected guides can be edited; an edit is re-checked like a new draft.
- QA cannot approve a guide they submitted themselves, and a rejection needs a reason.
- Only approved guides can be printed; every printed copy is counted in the audit trail.
- Closing a guide saves what was actually done as a new incident, so memory grows.
"""

from app.agent.tools import AgentDeps
from app.approval import new_record_id
from app.embeddings import incident_text
from app.guide import guardrails
from app.guide.translate import translate_guide
from app.kb import KnowledgeBase
from app.models import (
    Guide,
    GuideAction,
    GuideClose,
    GuideEdit,
    GuideEvent,
    GuideReview,
    GuideSummary,
    IncidentRecord,
)


class GuideError(ValueError):
    """A request the guide's current state does not allow."""

    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def load(guide_id: str, kb: KnowledgeBase) -> Guide:
    guide = kb.guides.get(guide_id)
    if guide is None:
        raise GuideError(f"No guide {guide_id}", status_code=404)
    return guide


def _same_person(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


def _save(guide: Guide, kb: KnowledgeBase, event: GuideEvent) -> Guide:
    guide.events.append(event)
    guide.updated_at = event.at
    kb.guides.put([guide])
    return guide


def _require(guide: Guide, *statuses: str, doing: str) -> None:
    if guide.status not in statuses:
        raise GuideError(f"This guide is {guide.status.replace('_', ' ')}; it cannot be {doing}.")


def summarize(guide: Guide) -> GuideSummary:
    author = next((e.by for e in guide.events if e.action == "created"), None)
    flags = len(guide.flags) + sum(
        len(i.flags) for i in [*guide.safety, *guide.steps, *guide.restart_checks]
    )
    return GuideSummary(
        id=guide.id,
        status=guide.status,
        version=guide.version,
        title=guide.title,
        asset_tag=guide.asset_tag,
        author=author,
        steps=len(guide.steps),
        copies_printed=guide.copies_printed,
        flags=flags,
        created_at=guide.created_at,
        updated_at=guide.updated_at,
    )


def list_guides(kb: KnowledgeBase, status: str | None = None) -> list[GuideSummary]:
    guides = kb.guides.all(status=status) if status else kb.guides.all()
    return [summarize(g) for g in sorted(guides, key=lambda g: g.updated_at, reverse=True)]


def edit(guide_id: str, body: GuideEdit, kb: KnowledgeBase) -> Guide:
    """Apply the manager's edits, re-checking sources, values, figures and parts."""
    guide = load(guide_id, kb)
    _require(guide, "draft", "rejected", doing="edited")
    sources = guardrails.source_texts(guide.similar_incidents, guide.manual_sections)
    figures = {f for s in guide.manual_sections for f in s.figure_ids}
    stock = {p.part_no: p for p in kb.parts.all()}

    guide.title = body.title.strip()
    guide.summary = body.summary.strip()
    guide.safety = [guardrails.check_item(i, sources) for i in body.safety if i.text.strip()]
    guide.steps = guardrails.check_steps(body.steps, sources, figures)
    guide.restart_checks = [
        guardrails.check_item(i, sources) for i in body.restart_checks if i.text.strip()
    ]
    guide.escalate_if = [t.strip() for t in body.escalate_if if t.strip()]
    guide.open_questions = [t.strip() for t in body.open_questions if t.strip()]
    if not guide.steps:
        raise GuideError("A guide needs at least one step.", status_code=422)
    guide.parts, part_flags = guardrails.check_parts(body.parts, stock)
    guide.flags = guardrails.guide_flags(guide.manual_sections, guide.steps) + part_flags
    cited = {c for i in [*guide.steps, *guide.safety, *guide.restart_checks] for c in i.citations}
    guide.downtime = guardrails.estimate_downtime(
        cited, guide.manual_sections, guide.similar_incidents, guide.error_codes
    )
    if guide.status == "rejected":
        guide.status = "draft"
        guide.version += 1
    guide.translations = []
    return _save(guide, kb, GuideEvent(by=body.by, action="edited"))


def submit(guide_id: str, body: GuideAction, deps: AgentDeps, kb: KnowledgeBase) -> Guide:
    """Translate the guide into the shop-floor languages and send it to QA."""
    guide = load(guide_id, kb)
    _require(guide, "draft", "rejected", doing="sent to QA")
    if not guide.steps:
        raise GuideError("A guide needs at least one step.", status_code=422)
    if guide.status == "rejected":
        guide.version += 1
    guide.translations = translate_guide(guide, deps.settings.guide_languages, deps)
    guide.status = "in_review"
    return _save(guide, kb, GuideEvent(by=body.by, action="submitted", comment=body.comment))


def review(guide_id: str, body: GuideReview, kb: KnowledgeBase) -> Guide:
    """QA approves the guide for printing, or sends it back with a reason."""
    guide = load(guide_id, kb)
    _require(guide, "in_review", doing="reviewed")
    submitter = next((e.by for e in reversed(guide.events) if e.action == "submitted"), None)
    if submitter and _same_person(submitter, body.by):
        raise GuideError(
            "The person who sent a guide to QA cannot approve or reject it.", status_code=403
        )
    comment = (body.comment or "").strip() or None
    if body.decision == "reject":
        if not comment:
            raise GuideError("Say what needs to change when rejecting a guide.", status_code=422)
        guide.status = "rejected"
        return _save(guide, kb, GuideEvent(by=body.by, action="rejected", comment=comment))
    guide.status = "approved"
    return _save(guide, kb, GuideEvent(by=body.by, action="approved", comment=comment))


def record_print(guide_id: str, body: GuideAction, kb: KnowledgeBase) -> Guide:
    """Count a printed copy. Only approved guides may be printed."""
    guide = load(guide_id, kb)
    _require(guide, "approved", doing="printed")
    guide.copies_printed += 1
    return _save(
        guide,
        kb,
        GuideEvent(by=body.by, action="printed", comment=f"Copy {guide.copies_printed}"),
    )


def close(guide_id: str, body: GuideClose, deps: AgentDeps, kb: KnowledgeBase) -> Guide:
    """Save what was actually done as a new incident, citing the guide, and close it."""
    guide = load(guide_id, kb)
    _require(guide, "approved", doing="closed")
    incident = guide.incident
    action = body.action_taken.strip()
    if body.parts_used and body.parts_used.strip():
        action += f" Parts used: {body.parts_used.strip()}."
    cited = [m.id for m in guide.similar_incidents]
    record = IncidentRecord(
        id=new_record_id("FIX"),
        industry=incident.industry,
        date=incident.date,
        area_or_equipment=guide.asset_tag or incident.area_or_equipment,
        description=guide.request,
        suspected_cause=incident.suspected_cause,
        root_cause=(body.root_cause or "").strip() or None,
        action_taken=action,
        outcome=body.outcome,
        downtime_minutes=body.downtime_minutes,
        source="guide_closure",
        source_ref=", ".join([guide.id, *cited]),
    )
    record.embedding = deps.embedder.embed_documents([incident_text(record)])[0]
    deps.store.upsert([record])
    guide.status = "closed"
    guide.closure_record_id = record.id
    return _save(
        guide,
        kb,
        GuideEvent(by=body.by, action="closed", comment=f"Saved to plant memory as {record.id}"),
    )
