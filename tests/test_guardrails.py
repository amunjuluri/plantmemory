from datetime import date

import pytest

from app.agent.guardrails import (
    CitationError,
    build_draft,
    check_citations,
    compute_recurrence,
    draft_citations,
    format_minutes,
    inline_citations,
    is_shallow_cause,
    normalize_inline_citations,
    ordinal,
)
from app.models import DraftContent, DraftItem, IncidentPublic, SimilarIncident, StructuredIncident

INCIDENT = StructuredIncident(
    date=date(2026, 10, 1), area_or_equipment="Line 1", description="Line stopped."
)


def match(
    record_id: str, record_date: date, outcome: str = "resolved", **fields
) -> SimilarIncident:
    record = IncidentPublic(
        id=record_id,
        date=record_date,
        area_or_equipment="Line 1",
        description="x",
        outcome=outcome,
        **fields,
    )
    return SimilarIncident(id=record_id, score=0.9, record=record)


def test_inline_citations_parses_single_and_grouped_ids() -> None:
    text = "Seen in [PAP-0001] and [PHA-0002, PHA-0003]; see note [1] and [sic]."
    assert inline_citations(text) == ["PAP-0001", "PHA-0002", "PHA-0003"]
    assert normalize_inline_citations("[A-1, B-2] and [1]") == "[A-1] [B-2] and [1]"


@pytest.mark.parametrize(
    "content",
    [
        DraftContent(summary="Same as [FAKE-0001]."),
        DraftContent(summary="ok", suggested_checks=[DraftItem(text="x", citations=["FAKE-1"])]),
        DraftContent(summary="ok", suggested_actions=[DraftItem(text="Do as in [FAKE-2].")]),
        DraftContent(summary="ok", open_questions=["Was [FAKE-3] the same pump?"]),
    ],
)
def test_citations_outside_search_results_are_rejected(content: DraftContent) -> None:
    with pytest.raises(CitationError) as err:
        check_citations(content, allowed_ids=["PAP-0001"])
    assert all(i.startswith("FAKE") for i in err.value.bad_ids)


def test_allowed_citations_pass() -> None:
    content = DraftContent(
        summary="As in [PAP-0001].",
        suggested_checks=[DraftItem(text="Check nozzles", citations=["PAP-0001"])],
    )
    check_citations(content, allowed_ids=["PAP-0001"])


def test_no_match_draft_says_so_and_is_all_general() -> None:
    content = DraftContent(
        summary="Start with the basics.",
        suggested_checks=[DraftItem(text="Check the drive", general=False)],
    )
    draft = build_draft(INCIDENT, content, matches=[], recurrence=None)
    assert draft.no_match
    assert draft.summary.startswith("No similar past incident found.")
    assert draft.similar_incidents == []
    assert draft.citations == []
    assert all(item.general and not item.citations for item in draft.suggested_checks)


def test_no_match_draft_rejects_any_citation() -> None:
    content = DraftContent(summary="No similar past incident found. Like [PAP-0001].")
    with pytest.raises(CitationError):
        build_draft(INCIDENT, content, matches=[], recurrence=None)


def test_uncited_items_are_labelled_general_and_cited_ones_are_not() -> None:
    m = match("PAP-0001", date(2026, 6, 1))
    content = DraftContent(
        summary="Like [PAP-0001].",
        suggested_checks=[
            DraftItem(text="Clean nozzles as in [PAP-0001]", general=True),
            DraftItem(text="Check the drive", general=False),
        ],
    )
    draft = build_draft(INCIDENT, content, matches=[m], recurrence=None)
    cited, general = draft.suggested_checks
    assert (cited.general, cited.citations) == (False, ["PAP-0001"])
    assert (general.general, general.citations) == (True, [])
    assert draft.review_notice and draft.status == "draft"


def test_recurrence_counts_window_and_failed_fixes() -> None:
    matches = [
        match("A-1", date(2026, 6, 1)),
        match("A-2", date(2025, 2, 1), outcome="recurred"),
    ]
    rec = compute_recurrence(INCIDENT, matches, window_months=12)
    assert rec.in_window == ["A-1"]
    assert rec.recurred == ["A-2"]
    assert rec.is_repeat
    assert "[A-1]" in rec.note and "[A-2] did not hold" in rec.note


def test_recurrence_reports_occurrence_and_downtime() -> None:
    matches = [
        match("A-1", date(2026, 6, 1), downtime_minutes=50),
        match("A-2", date(2026, 3, 1), downtime_minutes=80),
        match("A-3", date(2026, 1, 1)),
    ]
    rec = compute_recurrence(INCIDENT, matches, window_months=12)
    assert (rec.occurrence, rec.downtime_minutes, rec.downtime_records) == (4, 130, 2)
    assert rec.note.startswith("This is the 4th time in 12 months.")
    assert "Together 2 of them cost 2 h 10 min of downtime." in rec.note


def test_recurrence_without_downtime_says_nothing_about_cost() -> None:
    rec = compute_recurrence(INCIDENT, [match("A-1", date(2026, 6, 1))], window_months=12)
    assert rec.occurrence == 2 and rec.downtime_minutes == 0
    assert "downtime" not in rec.note


def test_public_records_from_other_sites_are_not_repeats() -> None:
    matches = [
        match("MDR-1", date(2026, 6, 1), source="public_record", source_ref="https://x"),
        match("MDR-2", date(2026, 5, 1), "recurred", source="public_record"),
        match("A-1", date(2026, 3, 1), source="guide_closure"),
    ]
    rec = compute_recurrence(INCIDENT, matches, window_months=12)
    assert rec.in_window == ["A-1"] and rec.recurred == [] and rec.occurrence == 2
    assert "MDR" not in rec.note


@pytest.mark.parametrize(
    ("n", "text"), [(1, "1st"), (2, "2nd"), (3, "3rd"), (4, "4th"), (11, "11th"), (22, "22nd")]
)
def test_ordinal(n: int, text: str) -> None:
    assert ordinal(n) == text


@pytest.mark.parametrize(("minutes", "text"), [(40, "40 min"), (60, "1 h"), (130, "2 h 10 min")])
def test_format_minutes(minutes: int, text: str) -> None:
    assert format_minutes(minutes) == text


@pytest.mark.parametrize(
    ("cause", "shallow"),
    [
        ("Operator error.", True),
        ("Human error during changeover", True),
        ("Operator retrained on aseptic behaviour", True),
        ("SOP not followed", True),
        ("Procedure not followed", True),
        ("Steam valve stuck open", False),
        (None, False),
    ],
)
def test_shallow_cause_detection(cause: str | None, shallow: bool) -> None:
    assert is_shallow_cause(cause) is shallow


def test_shallow_causes_are_flagged_in_draft() -> None:
    incident = INCIDENT.model_copy(update={"suspected_cause": "operator error"})
    m = match("PAP-0005", date(2026, 3, 1), outcome="recurred", root_cause="Operator error.")
    draft = build_draft(incident, DraftContent(summary="Like [PAP-0005]."), [m], None)
    assert len(draft.cause_flags) == 2
    assert "[PAP-0005]" in draft.cause_flags[1] and "came back" in draft.cause_flags[1]


def test_draft_citations_finds_ids_added_by_human_edits() -> None:
    m = match("PAP-0001", date(2026, 6, 1))
    draft = build_draft(INCIDENT, DraftContent(summary="Like [PAP-0001]."), [m], None)
    edited = draft.model_copy(update={"summary": draft.summary + " Also [PAP-0099]."})
    assert draft_citations(edited) == ["PAP-0001", "PAP-0099"]
