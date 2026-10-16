"""Plant status from the guides, and withdrawing a guide that is not needed."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.guide import workflow
from app.guide.plant import plant_status
from app.main import app
from app.models import (
    RELEASE_CHECKS,
    GuideAction,
    GuideClose,
    GuidePrint,
    GuideRelease,
    GuideReview,
    GuideWithdraw,
)
from tests.test_guide import draft, env  # noqa: F401  (the fixture)


def machine(kb, tag: str):
    return next(m for m in plant_status(kb).machines if m.tag == tag)


def approved(deps, kb):
    _, guide = draft(deps, kb)
    workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    workflow.review(guide.id, GuideReview(by="Sita", decision="approve"), kb)
    return guide


def backdate(kb, guide_id: str, hours: float) -> None:
    guide = kb.guides.get(guide_id)
    guide.created_at = datetime.now(UTC) - timedelta(hours=hours)
    kb.guides.put([guide])


def test_every_machine_runs_until_a_guide_is_drafted(env) -> None:  # noqa: F811
    _, kb = env
    status = plant_status(kb)
    assert [m.tag for m in status.machines] == ["TP-01", "TP-02"]
    assert all(m.state == "running" and m.since is None for m in status.machines)
    assert (status.running, status.stopped, status.awaiting_release, status.unassigned) == (
        2,
        0,
        0,
        0,
    )


def test_a_machine_follows_its_guide_from_stop_to_release(env) -> None:  # noqa: F811
    deps, kb = env
    _, guide = draft(deps, kb)
    tp02 = machine(kb, "TP-02")
    assert (tp02.state, tp02.stage, tp02.guide_id) == ("stopped", "draft", guide.id)
    assert tp02.since == guide.created_at and tp02.open_guides == 1
    assert tp02.equipment_model and tp02.guide_title == guide.title
    assert machine(kb, "TP-01").state == "running"

    workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    assert machine(kb, "TP-02").stage == "in_review"
    workflow.review(guide.id, GuideReview(by="Sita", decision="approve"), kb)
    workflow.record_print(guide.id, GuidePrint(by="Ravi"), kb)
    tp02 = machine(kb, "TP-02")
    assert (tp02.state, tp02.stage, tp02.copies_printed) == ("stopped", "approved", 1)

    workflow.close(guide.id, GuideClose(by="Ravi", action_taken="Freed the punch."), deps, kb)
    tp02 = machine(kb, "TP-02")
    assert (tp02.state, tp02.stage) == ("awaiting_release", "closed")
    assert plant_status(kb).awaiting_release == 1

    released = workflow.release(guide.id, GuideRelease(by="Sita", checks=list(RELEASE_CHECKS)), kb)
    tp02 = machine(kb, "TP-02")
    assert (tp02.state, tp02.stage, tp02.guide_id) == ("running", None, None)
    assert tp02.since == released.updated_at


def test_a_stop_counts_from_its_first_guide_and_opens_the_furthest_along(env) -> None:  # noqa: F811
    deps, kb = env
    _, first = draft(deps, kb)
    _, second = draft(deps, kb)
    backdate(kb, first.id, 3)
    workflow.submit(second.id, GuideAction(by="Ravi"), deps, kb)
    tp02 = machine(kb, "TP-02")
    assert tp02.open_guides == 2 and tp02.guide_id == second.id and tp02.stage == "in_review"
    assert tp02.since == kb.guides.get(first.id).created_at


def test_a_new_stop_while_waiting_for_release_shows_as_stopped(env) -> None:  # noqa: F811
    deps, kb = env
    repaired = approved(deps, kb)
    workflow.close(repaired.id, GuideClose(by="Ravi", action_taken="Freed it."), deps, kb)
    backdate(kb, repaired.id, 5)
    _, again = draft(deps, kb)
    tp02 = machine(kb, "TP-02")
    assert (tp02.state, tp02.guide_id, tp02.open_guides) == ("stopped", again.id, 2)
    assert tp02.since == again.created_at


def test_longest_stop_first_then_waiting_then_running(env) -> None:  # noqa: F811
    deps, kb = env
    _, recent = draft(deps, kb)
    old = kb.guides.get(recent.id).model_copy(
        update={
            "id": "GDE-OLD",
            "asset_tag": "TP-01",
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )
    unknown = old.model_copy(update={"id": "GDE-NEW-MACHINE", "asset_tag": "FBD-9"})
    nameless = old.model_copy(update={"id": "GDE-NAMELESS", "asset_tag": None})
    gone = old.model_copy(update={"id": "GDE-GONE", "asset_tag": None, "status": "withdrawn"})
    kb.guides.put([old, unknown, nameless, gone])
    status = plant_status(kb)
    assert [m.tag for m in status.machines] == ["FBD-9", "TP-01", "TP-02"]
    assert status.machines[0].equipment_model is None
    assert (status.stopped, status.running, status.unassigned) == (3, 0, 1)


def test_withdrawing_a_guide_puts_the_machine_back(env) -> None:  # noqa: F811
    deps, kb = env
    _, guide = draft(deps, kb)
    with pytest.raises(ValueError):
        GuideWithdraw(by="Ravi", reason="")
    gone = workflow.withdraw(guide.id, GuideWithdraw(by="Ravi", reason=" Restarted by itself "), kb)
    assert gone.status == "withdrawn"
    assert (gone.events[-1].action, gone.events[-1].comment) == ("withdrawn", "Restarted by itself")
    assert machine(kb, "TP-02").state == "running"
    with pytest.raises(workflow.GuideError):
        workflow.withdraw(guide.id, GuideWithdraw(by="Ravi", reason="again"), kb)
    with pytest.raises(workflow.GuideError):
        workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)


def test_a_printed_or_finished_guide_cannot_be_withdrawn(env) -> None:  # noqa: F811
    deps, kb = env
    unprinted = approved(deps, kb)
    assert workflow.withdraw(unprinted.id, GuideWithdraw(by="Ravi", reason="Duplicate"), kb)

    printed = approved(deps, kb)
    workflow.record_print(printed.id, GuidePrint(by="Ravi"), kb)
    with pytest.raises(workflow.GuideError, match="printed copy"):
        workflow.withdraw(printed.id, GuideWithdraw(by="Ravi", reason="Duplicate"), kb)
    workflow.close(printed.id, GuideClose(by="Ravi", action_taken="Freed it."), deps, kb)
    with pytest.raises(workflow.GuideError, match="closed"):
        workflow.withdraw(printed.id, GuideWithdraw(by="Ravi", reason="Duplicate"), kb)


def test_plant_and_withdraw_api(env) -> None:  # noqa: F811
    deps, kb = env
    client = TestClient(app)
    _, guide = draft(deps, kb)
    body = client.get("/api/plant").json()
    assert (body["stopped"], body["running"]) == (1, 1)
    assert body["machines"][0]["tag"] == "TP-02" and body["machines"][0]["guide_id"] == guide.id

    url = f"/api/guides/{guide.id}/withdraw"
    assert client.post(url, json={"by": "Ravi", "reason": ""}).status_code == 422
    ok = client.post(url, json={"by": "Ravi", "reason": "Reported twice"})
    assert ok.status_code == 200 and ok.json()["status"] == "withdrawn"
    assert client.post(url, json={"by": "Ravi", "reason": "Reported twice"}).status_code == 409
    assert client.get("/api/plant").json()["stopped"] == 0
    assert client.get("/api/guides", params={"status": "withdrawn"}).json()[0]["id"] == guide.id
    assert (
        client.post("/api/guides/GDE-NOPE/withdraw", json={"by": "R", "reason": "x y"}).status_code
        == 404
    )
