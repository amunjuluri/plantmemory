"""Agent tools, the ADK agent loop and the analyze/approve API, with Gemini mocked."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from google.adk.runners import InMemoryRunner

from app import main
from app.agent import agent, tools
from app.agent.guardrails import CitationError
from app.llm import BUSY_MESSAGE
from app.main import app
from app.models import DraftContent, DraftItem, SimilarIncident
from tests.fakes import (
    AGENT_STEPS,
    MATCHING,
    UNRELATED,
    FakeLLM,
    OverloadedAdkModel,
    ScriptedAdkModel,
    make_deps,
    overloaded_error,
)

GOOD_DRAFT = DraftContent(
    summary="Same symptoms as [PAP-0001]; the earlier fix in [PAP-0005] did not hold.",
    suggested_checks=[DraftItem(text="Check HP shower nozzles", citations=["PAP-0001"])],
    suggested_actions=[DraftItem(text="Run a felt wash")],
    open_questions=["Has the furnish changed?"],
)
INVENTED_DRAFT = DraftContent(summary="This matches [PAP-0999] from last year.")


@pytest.fixture
def use_deps(tmp_path: Path):
    """Install fake deps for the tools; returns a factory so tests pick the query vector."""

    def install(query_vector=MATCHING, drafts=(GOOD_DRAFT,), **incident_fields):
        deps = make_deps(tmp_path, query_vector, FakeLLM(list(drafts), **incident_fields))
        tools.set_deps(deps)
        return deps

    yield install
    tools.set_deps(None)


def run_tools(deps):
    incident = tools.structure_incident("Web keeps breaking after the press.", deps)
    matches = tools.search_similar(incident, deps)
    recurrence = tools.check_recurrence(incident, matches, deps)
    return tools.draft_report(incident, matches, recurrence, deps)


# --- tools ---


def test_structure_keeps_original_wording(use_deps) -> None:
    deps = use_deps()
    incident = tools.structure_incident("web brk x4 after PR2", deps, industry="paper")
    assert incident.description == "web brk x4 after PR2"
    assert incident.industry == "paper"


def test_draft_cites_only_search_results(use_deps) -> None:
    draft = run_tools(use_deps())
    assert not draft.no_match
    assert [m.id for m in draft.similar_incidents] == ["PAP-0001", "PAP-0005"]
    assert set(draft.citations) <= {"PAP-0001", "PAP-0005"}
    assert draft.suggested_actions[0].general is True
    assert "[PAP-0005] did not hold" in draft.recurrence_note
    assert any("[PAP-0005]" in flag for flag in draft.cause_flags)


def test_invented_citation_is_retried_then_accepted(use_deps) -> None:
    deps = use_deps(drafts=(INVENTED_DRAFT, GOOD_DRAFT))
    draft = run_tools(deps)
    assert "PAP-0999" not in draft.citations
    retry_prompt = deps.llm.prompts[-1][1]
    assert "PAP-0999" in retry_prompt and "citation rule" in retry_prompt


def test_invented_citation_twice_is_rejected(use_deps) -> None:
    deps = use_deps(drafts=(INVENTED_DRAFT, INVENTED_DRAFT))
    with pytest.raises(CitationError, match="PAP-0999"):
        run_tools(deps)


def test_below_threshold_ids_cannot_be_cited(use_deps) -> None:
    # PHA-0003 is returned by search (k=5) but scores ~0, so it is not citable.
    deps = use_deps(drafts=(DraftContent(summary="See [PHA-0003]."),) * 2)
    with pytest.raises(CitationError, match="PHA-0003"):
        run_tools(deps)


def test_no_match_uses_no_match_prompt_and_output(use_deps) -> None:
    general = DraftContent(
        summary="No similar past incident found. Start with general checks.",
        suggested_checks=[DraftItem(text="Check the drive logs", general=True)],
    )
    deps = use_deps(query_vector=UNRELATED, drafts=(general,))
    draft = run_tools(deps)
    assert draft.no_match
    assert draft.similar_incidents == [] and draft.citations == []
    assert draft.recurrence_note is None
    assert all(i.general for i in draft.suggested_checks)
    prompt = deps.llm.prompts[-1][1]
    assert "SIMILAR PAST INCIDENTS: none" in prompt and "PAP-0001" not in prompt


# --- ADK agent ---


def test_tools_refuse_to_run_out_of_order(use_deps) -> None:
    use_deps()
    ctx = SimpleNamespace(state={})
    for tool in (agent.check_recurrence, agent.draft_report):
        result = asyncio.run(tool(ctx))
        assert result["status"] == "error"
    result = asyncio.run(agent.search_similar(ctx))
    assert result == {"status": "error", "error": "Call structure_incident first."}


@pytest.fixture
def scripted_runner(monkeypatch):
    def install(steps=AGENT_STEPS):
        runner = InMemoryRunner(
            agent=agent.build_agent(model=ScriptedAdkModel(steps=steps)), app_name=agent.APP_NAME
        )
        monkeypatch.setattr(agent, "get_runner", lambda: runner)
        return runner

    return install


def test_analyze_endpoint_runs_agent_and_returns_draft(use_deps, scripted_runner) -> None:
    use_deps()
    scripted_runner()
    text = "Web keeps breaking after the press, felt looks glazed."
    response = TestClient(app).post("/api/incidents/analyze", json={"text": text})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["incident"]["description"] == text  # user's words, not the model's
    assert body["status"] == "draft"
    assert "review" in body["review_notice"]
    assert body["similar_incidents"][0]["id"] == "PAP-0001"
    assert "embedding" not in body["similar_incidents"][0]["record"]


def test_analyze_returns_502_when_agent_skips_drafting(use_deps, scripted_runner) -> None:
    use_deps()
    scripted_runner(steps=AGENT_STEPS[:2])
    response = TestClient(app).post("/api/incidents/analyze", json={"text": "Line 3 stopped."})
    assert response.status_code == 502


def test_analyze_says_gemini_is_busy_instead_of_crashing(use_deps, monkeypatch) -> None:
    use_deps()
    runner = InMemoryRunner(
        agent=agent.build_agent(model=OverloadedAdkModel()), app_name=agent.APP_NAME
    )
    monkeypatch.setattr(agent, "get_runner", lambda: runner)
    response = TestClient(app).post("/api/incidents/analyze", json={"text": "Line 3 stopped."})
    assert response.status_code == 502
    assert response.json()["detail"] == BUSY_MESSAGE


def test_gemini_overload_outside_the_agent_returns_503(monkeypatch) -> None:
    def busy(*args, **kwargs):
        raise overloaded_error(503)

    monkeypatch.setattr(main.logbook_ocr, "extract_records", busy)
    response = TestClient(app).post(
        "/api/ingest/logbook", files={"file": ("page.jpg", b"x", "image/jpeg")}
    )
    assert response.status_code == 503
    assert response.json()["detail"] == BUSY_MESSAGE
    assert response.headers["retry-after"] == "30"


# --- approve and list ---


def test_approve_saves_record_that_search_can_find(use_deps) -> None:
    deps = use_deps()
    draft = run_tools(deps)
    client = TestClient(app)
    response = client.post(
        "/api/incidents/approve",
        json={
            "draft": draft.model_dump(mode="json"),
            "root_cause": "HP shower nozzles plugged",
            "outcome": "resolved",
        },
    )
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["id"].startswith("APR-")
    assert saved["source"] == "approved_draft"
    assert "embedding" not in saved
    assert deps.store.get(saved["id"]).embedding

    listing = client.get("/api/incidents", params={"limit": 2}).json()
    assert listing["total"] == 4
    assert listing["items"][0]["id"] == saved["id"]  # newest date first


def test_approve_rejects_unknown_citations(use_deps) -> None:
    deps = use_deps()
    draft = run_tools(deps)
    draft.summary += " Also like [PAP-0999]."
    response = TestClient(app).post(
        "/api/incidents/approve", json={"draft": draft.model_dump(mode="json")}
    )
    assert response.status_code == 422
    assert "PAP-0999" in response.json()["detail"]


def test_relevant_needs_threshold_and_margin(use_deps) -> None:
    settings = use_deps().settings  # threshold 0.70, margin 0.06
    scored = [SimilarIncident(id=f"R-{i}", score=s) for i, s in enumerate([0.87, 0.85, 0.79, 0.6])]
    assert [m.id for m in tools.relevant(scored, settings)] == ["R-0", "R-1"]
    assert tools.relevant([SimilarIncident(id="R-9", score=0.69)], settings) == []


def test_stream_endpoint_reports_each_step_then_draft(use_deps, scripted_runner) -> None:
    use_deps()
    scripted_runner()
    with TestClient(app).stream(
        "POST", "/api/incidents/analyze/stream", json={"text": "Web breaks after the press."}
    ) as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        events = [
            json.loads(line.removeprefix("data: "))
            for line in response.iter_lines()
            if line.startswith("data: ")
        ]
    steps = [(e["step"], e["status"]) for e in events if e["type"] == "step"]
    assert steps == [(name, s) for name, _ in AGENT_STEPS for s in ("started", "done")]
    assert events[-1]["type"] == "draft"
    assert events[-1]["draft"]["similar_incidents"][0]["id"] == "PAP-0001"


def test_step_summaries_are_plain_language() -> None:
    assert agent.step_summary("search_similar", {"matches": [{"same_problem": True}]}) == (
        "1 similar incident found"
    )
    assert agent.step_summary("search_similar", {"matches": []}) == "No close match in memory"
    summary = agent.step_summary(
        "check_recurrence",
        {"window_months": 12, "is_repeat": True, "in_window": ["A-1", "A-2"], "recurred": ["A-2"]},
    )
    assert summary == "3rd time in 12 months. 1 past fix did not hold"
    summary = agent.step_summary(
        "check_recurrence",
        {"window_months": 12, "is_repeat": True, "in_window": ["A-1"], "downtime_minutes": 130},
    )
    assert summary == "2nd time in 12 months, 2 h 10 min lost before"


def test_stream_steps_carry_summaries(use_deps, scripted_runner) -> None:
    use_deps()
    scripted_runner()
    with TestClient(app).stream(
        "POST", "/api/incidents/analyze/stream", json={"text": "Web breaks after the press."}
    ) as response:
        events = [json.loads(x[6:]) for x in response.iter_lines() if x.startswith("data: ")]
    done = {e["step"]: e["summary"] for e in events if e.get("status") == "done"}
    assert done["search_similar"] == "2 similar incidents found"
    assert done["draft_report"].startswith("Draft ready, citing")


def test_get_incident_by_id(use_deps) -> None:
    use_deps()
    client = TestClient(app)
    body = client.get("/api/incidents/PAP-0001").json()
    assert body["id"] == "PAP-0001" and "embedding" not in body
    assert client.get("/api/incidents/NOPE-1").status_code == 404
