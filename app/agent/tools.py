"""The four steps the agent runs, as plain functions so they can be tested directly.

The ADK agent (app/agent/agent.py) wraps these and passes results between them through
session state.
"""

import json
import logging
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from app.agent import prompts
from app.agent.guardrails import CitationError, build_draft, compute_recurrence
from app.config import Settings, get_settings
from app.embeddings import GeminiEmbedder, incident_text
from app.llm import GeminiLLM, StructuredLLM
from app.models import (
    Draft,
    DraftContent,
    IncidentPublic,
    Industry,
    MatchCheck,
    Recurrence,
    SimilarIncident,
    StructuredIncident,
)
from app.store import IncidentStore, get_store

log = logging.getLogger(__name__)


class QueryEmbedder(Protocol):
    def embed_query(self, text: str) -> list[float]: ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...


@dataclass
class AgentDeps:
    """Everything the tools need. Swapped for fakes in tests."""

    settings: Settings
    store: IncidentStore
    embedder: QueryEmbedder
    llm: StructuredLLM


_deps: AgentDeps | None = None


def get_deps() -> AgentDeps:
    """Return the process-wide dependencies, creating the real ones on first use."""
    global _deps
    if _deps is None:
        settings = get_settings()
        _deps = AgentDeps(
            settings=settings,
            store=get_store(),
            embedder=GeminiEmbedder(settings),
            llm=GeminiLLM(settings),
        )
    return _deps


def set_deps(deps: AgentDeps | None) -> None:
    """Override the dependencies (tests), or reset them with None."""
    global _deps
    _deps = deps


def structure_incident(
    text: str, deps: AgentDeps, industry: Industry | None = None, today: date | None = None
) -> StructuredIncident:
    """Turn a free-text incident description into a `StructuredIncident`."""
    rule = prompts.INDUSTRY_FIXED.format(industry=industry) if industry else prompts.INDUSTRY_INFER
    prompt = prompts.STRUCTURE_PROMPT.format(
        today=(today or date.today()).isoformat(), industry_rule=rule, text=text
    )
    # If no answer arrives in 5 s, a second copy is sent (see scripts/benchmark.py).
    incident = deps.llm.generate(prompt, StructuredIncident, thinking="low", hedge_after_s=5.0)
    # The original wording is evidence; never let the model paraphrase it.
    update: dict = {"description": text}
    if industry:
        update["industry"] = industry
    return incident.model_copy(update=update)


def search_similar(
    incident: StructuredIncident, deps: AgentDeps, k: int = 5, industry: Industry | None = None
) -> list[SimilarIncident]:
    """Embed the incident and return the k most similar stored records, best first."""
    vector = deps.embedder.embed_query(incident_text(incident))
    hits = deps.store.search(vector, k=k, industry=industry)
    return [
        SimilarIncident(
            id=h.record.id,
            score=round(max(-1.0, min(1.0, h.score)), 4),
            record=IncidentPublic.model_validate(h.record.model_dump(exclude={"embedding"})),
        )
        for h in hits
    ]


def candidates(matches: list[SimilarIncident], settings: Settings) -> list[SimilarIncident]:
    """Search results close enough to be worth checking: score at least MATCH_THRESHOLD."""
    return [m for m in matches if m.score >= settings.match_threshold]


def verify_matches(
    incident: StructuredIncident, matches: list[SimilarIncident], deps: AgentDeps
) -> list[SimilarIncident]:
    """Keep only the candidates the model judges to be the same problem.

    Search scores alone cannot tell "same machine, different problem" apart from a true
    repeat, so the model checks each candidate. It can only remove candidates: ids it
    invents are ignored, and a candidate it gives no verdict for is dropped.
    """
    pool = candidates(matches, deps.settings)
    if not pool:
        return []
    prompt = prompts.VERIFY_PROMPT.format(
        incident=incident.model_dump_json(
            indent=1, include={"area_or_equipment", "description", "suspected_cause"}
        ),
        candidates=json.dumps([_candidate_for_prompt(m) for m in pool], indent=1),
    )
    # Normally 2 to 6 s, but one run took 14 s; a second copy is sent after 7 s.
    check = deps.llm.generate(prompt, MatchCheck, thinking="low", hedge_after_s=7.0)
    same = {v.id: v.why for v in check.verdicts if v.same_problem}
    return [m.model_copy(update={"why": same[m.id]}) for m in pool if m.id in same]


def _candidate_for_prompt(m: SimilarIncident) -> dict:
    fields = m.record.model_dump(
        mode="json",
        include={"area_or_equipment", "description", "suspected_cause", "root_cause"},
    )
    return {"id": m.id, **fields}


def check_recurrence(
    incident: StructuredIncident, matches: list[SimilarIncident], deps: AgentDeps
) -> Recurrence:
    """Count confirmed matches in the recurrence window and note past fixes that failed.

    `matches` must already be checked by `verify_matches`.
    """
    return compute_recurrence(incident, matches, deps.settings.recurrence_window_months)


def _match_for_prompt(m: SimilarIncident) -> dict:
    r = m.record
    fields = r.model_dump(
        mode="json",
        include={
            "date",
            "area_or_equipment",
            "description",
            "suspected_cause",
            "root_cause",
            "action_taken",
            "outcome",
            "downtime_minutes",
        },
    )
    where = (
        f"another site (public record: {r.source_ref})"
        if r.source == "public_record"
        else "this plant"
    )
    return {"id": m.id, "similarity": m.score, "where": where, **fields}


def draft_report(
    incident: StructuredIncident,
    matches: list[SimilarIncident],
    recurrence: Recurrence | None,
    deps: AgentDeps,
) -> Draft:
    """Ask the model for a draft, enforce the citation and no-match rules, and return it.

    `matches` must already be checked by `verify_matches`; they are the only citable ids.

    The model gets one retry if it cites an id the search did not return; a second
    violation raises CitationError.
    """
    good = matches
    allowed = [m.id for m in good]

    if good:
        evidence = prompts.EVIDENCE_MATCHES.format(
            matches=json.dumps([_match_for_prompt(m) for m in good], indent=1),
            recurrence=(recurrence.note if recurrence and recurrence.note else "No repeats."),
        )
        extra = prompts.EXTRA_RULES_MATCHES
    else:
        evidence = prompts.EVIDENCE_NONE
        extra = prompts.EXTRA_RULES_NONE

    prompt = prompts.DRAFT_PROMPT.format(
        incident=incident.model_dump_json(indent=1),
        evidence=evidence,
        example_id=allowed[0] if allowed else "RECORD-ID",
        allowed_ids=", ".join(allowed) or "none",
        extra_rules=extra,
    )

    content = deps.llm.generate(prompt, DraftContent, thinking=deps.settings.draft_thinking_level)
    try:
        return build_draft(incident, content, good, recurrence)
    except CitationError as err:
        log.warning("Draft rejected, retrying once: %s", err)
        retry = prompt + prompts.CITATION_RETRY.format(
            bad_ids=", ".join(err.bad_ids), allowed_ids=", ".join(allowed) or "none"
        )
        content = deps.llm.generate(
            retry, DraftContent, thinking=deps.settings.draft_thinking_level
        )
        return build_draft(incident, content, good, recurrence)
