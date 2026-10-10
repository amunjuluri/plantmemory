"""Rules enforced in code, whatever the model writes.

- Every citation must be one of the record ids the search returned above the threshold.
- With no match above the threshold, the draft says so and contains only general advice.
- An uncited suggestion is always labelled general.
- Shallow causes ("operator error", "retrained") are flagged for deeper investigation.
- The draft is always a draft with a human-review notice.
"""

import re
from collections.abc import Iterable
from datetime import timedelta

from app.agent.prompts import NO_MATCH_SUMMARY
from app.models import (
    REVIEW_NOTICE,
    Draft,
    DraftContent,
    DraftItem,
    IncidentCore,
    Recurrence,
    SimilarIncident,
    StructuredIncident,
)

# A record id is alphanumeric parts joined by hyphens, e.g. PAP-0001 or APR-3F9A1C2B.
_ID = r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+"
_BRACKET = re.compile(r"\[([^\[\]]{1,200})\]")
_ID_TOKEN = re.compile(rf"^{_ID}$")

# Industry-neutral phrases that usually stop an investigation too early.
SHALLOW_CAUSE_PATTERNS = [
    r"\boperator (error|mistake|technique)\b",
    r"\bhuman (error|factor)s?\b",
    r"\bre-?train(ed|ing)?\b",
    r"\bcareless(ness)?\b",
    r"\b(lack of|poor) (attention|awareness|care)\b",
    r"\b(not following|did not follow|failed to follow) (the )?(sop|procedure|instructions?)\b",
    r"\b(sop|procedure|instructions?) (was |were )?not followed\b",
]
_SHALLOW = re.compile("|".join(SHALLOW_CAUSE_PATTERNS), re.IGNORECASE)


class CitationError(ValueError):
    """The draft cites record ids that the search did not return."""

    def __init__(self, bad_ids: Iterable[str], allowed_ids: Iterable[str]):
        self.bad_ids = sorted(set(bad_ids))
        self.allowed_ids = sorted(set(allowed_ids))
        allowed = ", ".join(self.allowed_ids) or "none"
        super().__init__(f"Cited ids not returned by search: {self.bad_ids} (allowed: {allowed})")


def inline_citations(text: str) -> list[str]:
    """Return record ids cited in square brackets, e.g. "[A-1]" or "[A-1, B-2]"."""
    ids: list[str] = []
    for group in _BRACKET.findall(text):
        for token in re.split(r"[,;\s]+", group.strip()):
            if _ID_TOKEN.match(token):
                ids.append(token)
    return ids


def normalize_inline_citations(text: str) -> str:
    """Rewrite "[A-1, B-2]" as "[A-1] [B-2]" so every bracket holds exactly one id."""

    def split(match: re.Match[str]) -> str:
        tokens = [t for t in re.split(r"[,;\s]+", match.group(1).strip()) if t]
        if len(tokens) > 1 and all(_ID_TOKEN.match(t) for t in tokens):
            return " ".join(f"[{t}]" for t in tokens)
        return match.group(0)

    return _BRACKET.sub(split, text)


def _content_texts(content: DraftContent) -> list[str]:
    items = content.suggested_checks + content.suggested_actions
    return [
        content.summary,
        *(m.why for m in content.match_explanations),
        *(i.text for i in items),
        *content.open_questions,
    ]


def cited_ids(content: DraftContent) -> list[str]:
    """Every id the content cites, inline or in item citation lists, in first-seen order."""
    ids: list[str] = []
    for text in _content_texts(content):
        ids.extend(inline_citations(text))
    for item in content.suggested_checks + content.suggested_actions:
        ids.extend(item.citations)
    ids.extend(m.id for m in content.match_explanations)
    return list(dict.fromkeys(ids))


def draft_citations(draft: Draft) -> list[str]:
    """Every id a (possibly human-edited) draft cites, anywhere in it."""
    content = DraftContent(
        summary=draft.summary + " " + (draft.recurrence_note or ""),
        suggested_checks=draft.suggested_checks,
        suggested_actions=draft.suggested_actions,
        open_questions=draft.open_questions + draft.cause_flags,
    )
    return list(dict.fromkeys(draft.citations + cited_ids(content)))


def check_citations(content: DraftContent, allowed_ids: Iterable[str]) -> None:
    """Raise CitationError if the content cites any id outside `allowed_ids`."""
    allowed = set(allowed_ids)
    bad = [i for i in cited_ids(content) if i not in allowed]
    if bad:
        raise CitationError(bad, allowed)


def is_shallow_cause(text: str | None) -> bool:
    """True when a cause stops at blaming people or retraining."""
    return bool(text and _SHALLOW.search(text))


def shallow_cause_flags(incident: StructuredIncident, matches: list[SimilarIncident]) -> list[str]:
    """Plain-language warnings for shallow causes in the new incident or matched records."""
    flags: list[str] = []
    for label, cause in (
        ("suspected cause", incident.suspected_cause),
        ("root cause", incident.root_cause),
    ):
        if is_shallow_cause(cause):
            flags.append(
                f'The {label} "{cause}" blames a person, not a mechanism. Ask why the error '
                "was possible (procedure, equipment design, alarms, workload) before closing."
            )
    for match in matches:
        record = match.record
        if record is None:
            continue
        cause = record.root_cause or record.suspected_cause
        if is_shallow_cause(cause):
            recurred = " and the problem came back" if record.outcome == "recurred" else ""
            flags.append(
                f'[{match.id}] recorded "{cause}" as the cause{recurred}. Treat that fix as '
                "unproven and look for the underlying mechanism."
            )
    return flags


def compute_recurrence(
    incident: IncidentCore, matches: list[SimilarIncident], window_months: int
) -> Recurrence:
    """Count similar records in the window before this incident and failed past fixes."""
    start = incident.date - timedelta(days=round(window_months * 30.44))
    dated = [m for m in matches if m.record is not None]
    in_window = [m for m in dated if start <= m.record.date <= incident.date]
    recurred = [m for m in dated if m.record.outcome == "recurred"]

    parts: list[str] = []
    if in_window:
        listed = ", ".join(f"[{m.id}] ({m.record.date.isoformat()})" for m in in_window)
        n = len(in_window)
        plural = "incident" if n == 1 else "incidents"
        parts.append(f"Repeat: {n} similar {plural} in the last {window_months} months: {listed}.")
    for m in recurred:
        parts.append(f"The fix recorded in [{m.id}] did not hold (outcome: recurred).")

    return Recurrence(
        window_months=window_months,
        in_window=[m.id for m in in_window],
        recurred=[m.id for m in recurred],
        is_repeat=bool(in_window),
        note=" ".join(parts) or None,
    )


def _finalize_item(item: DraftItem) -> DraftItem:
    citations = list(dict.fromkeys(item.citations + inline_citations(item.text)))
    return DraftItem(
        text=normalize_inline_citations(item.text),
        citations=citations,
        general=not citations,
    )


def build_draft(
    incident: StructuredIncident,
    content: DraftContent,
    matches: list[SimilarIncident],
    recurrence: Recurrence | None,
) -> Draft:
    """Check the model's content against the rules and assemble the final `Draft`.

    `matches` must already be filtered to those at or above the match threshold.
    Raises CitationError if the content cites anything else.
    """
    allowed = [m.id for m in matches]
    check_citations(content, allowed)
    no_match = not matches

    summary = normalize_inline_citations(content.summary.strip())
    checks = [_finalize_item(i) for i in content.suggested_checks]
    actions = [_finalize_item(i) for i in content.suggested_actions]
    if no_match and not summary.startswith(NO_MATCH_SUMMARY):
        summary = f"{NO_MATCH_SUMMARY} {summary}"

    why = {m.id: m.why for m in content.match_explanations}
    similar = [m.model_copy(update={"why": why.get(m.id, m.why)}) for m in matches]
    cited = cited_ids(content)
    recurrence_note = None if no_match or recurrence is None else recurrence.note
    if recurrence_note:
        cited = list(dict.fromkeys(cited + inline_citations(recurrence_note)))

    return Draft(
        incident=incident,
        summary=summary,
        no_match=no_match,
        similar_incidents=similar,
        recurrence_note=recurrence_note,
        suggested_checks=checks,
        suggested_actions=actions,
        open_questions=[normalize_inline_citations(q) for q in content.open_questions],
        cause_flags=shallow_cause_flags(incident, matches),
        citations=cited,
        status="draft",
        review_notice=REVIEW_NOTICE,
    )
