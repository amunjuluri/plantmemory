"""Repair guides: drafting rules, translation checks, the QA workflow and the API, with
Gemini mocked."""

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent import tools
from app.guide import guardrails, workflow
from app.guide.builder import build_guide_events, find_asset, find_codes
from app.guide.translate import missing_tokens
from app.kb import set_kb
from app.main import app
from app.models import (
    RELEASE_CHECKS,
    Asset,
    GuideAction,
    GuideClose,
    GuideContent,
    GuideEdit,
    GuideItemOut,
    GuidePartPick,
    GuideRelease,
    GuideRequest,
    GuideReview,
    GuideStep,
    GuideStepOut,
    ManualPick,
    TranslationOut,
)
from tests.fakes import MATCHING, PNG_BYTES, FakeLLM, make_deps, make_kb

REQUEST = "TP-02 stopped, screen shows E-104 punch tight."

CONTENT = GuideContent(
    title="TP-02 E-104: free the tight punch [MAN-RTP37-16]",
    summary="Possible cause: fines in the guide [PAP-0001].",
    safety=[
        GuideItemOut(text="Lock isolator Q1 and release V3 to 0 bar.", citations=["MAN-RTP37-3"])
    ],
    steps=[
        GuideStepOut(
            text="Remove the punch with tool T-12.",
            citations=["MAN-RTP37-16"],
            caution=None,
            figure_id="FIG-1",
        ),
        GuideStepOut(
            text="Tighten the guide to 25 Nm.",
            citations=["MAN-RTP37-16"],
            caution=None,
            figure_id="FIG-1",
        ),
        GuideStepOut(
            text="Clean the bore with 70% IPA [MAN-RTP37-16].",
            citations=["MAN-RTP37-99"],
            caution="Never use a metal brush.",
            figure_id="FIG-404",
        ),
        GuideStepOut(text="Check the cam track.", citations=[], caution=None, figure_id=None),
    ],
    parts=[
        GuidePartPick(part_no="RTP-BS-07", qty=1, why="if the gauge fails"),
        GuidePartPick(part_no="RTP-BT-04", qty=1, why="belt"),
        GuidePartPick(part_no="XX-1", qty=1, why="made up"),
    ],
    restart_checks=[
        GuideItemOut(
            text="Run the turret empty at 10 rpm for 2 minutes.", citations=["MAN-RTP37-28"]
        )
    ],
    escalate_if=["The gauge does not pass [MAN-RTP37-16]."],
    open_questions=["Which station is tight?"],
)


def fake_translation(contents: str) -> TranslationOut:
    """Echo the English with a prefix; drop T-12 from step 1 and write 10 in Telugu digits."""
    source = json.loads(contents.split("ENGLISH:\n", 1)[1])

    def tr(items: list[str]) -> list[str]:
        return [f"TE {i}" if i else "" for i in items]

    steps = tr(source["steps"])
    steps[0] = steps[0].replace("T-12", "")
    checks = [c.replace("10", "౧౦") for c in tr(source["restart_checks"])]
    return TranslationOut(
        title=f"TE {source['title']}",
        summary=f"TE {source['summary']}",
        safety=tr(source["safety"]),
        steps=steps,
        step_cautions=tr(source["step_cautions"]),
        restart_checks=checks,
        escalate_if=tr(source["escalate_if"]),
    )


@pytest.fixture
def env(tmp_path: Path):
    llm = FakeLLM(area_or_equipment="TP-02 press", description=REQUEST)
    llm.responses[GuideContent] = CONTENT
    llm.responses[TranslationOut] = fake_translation
    deps = make_deps(tmp_path, MATCHING, llm)
    kb = make_kb(tmp_path)
    tools.set_deps(deps)
    set_kb(kb)
    yield deps, kb
    tools.set_deps(None)
    set_kb(None)


def draft(deps, kb, text: str = REQUEST):
    async def run():
        return [e async for e in build_guide_events(GuideRequest(text=text, by="Ravi"), deps, kb)]

    events = asyncio.run(run())
    assert events[-1].type == "guide", events[-1]
    return events, events[-1].guide


# --- finding the machine and codes ---


def test_find_codes_handles_hmi_spellings() -> None:
    assert find_codes("alarm E104 then w 212, also ALM-12") == ["E-104", "W-212", "ALM-12"]


@pytest.mark.parametrize("text", ["TP-02 stopped", "tp02 stopped", "TP 2 stopped"])
def test_find_asset_matches_tag_variants(text: str) -> None:
    assets = [Asset(tag="TP-02", equipment_model="press"), Asset(tag="BL-3", equipment_model="b")]
    assert find_asset([text], assets).tag == "TP-02"
    assert find_asset(["nothing here"], assets) is None
    assert find_asset(["TP-02"], assets, requested="bl3").tag == "BL-3"


def test_values_with_units_reads_ranges_and_units() -> None:
    found = guardrails.values_with_units("8 to 10 mm at 50 N, 121 °C, 1.3 mbar/min, 70% IPA")
    assert found == {
        ("8", "mm"),
        ("10", "mm"),
        ("50", "n"),
        ("121", "c"),
        ("1.3", "mbar/min"),
        ("70", "%"),
    }
    assert guardrails.values_with_units("E-104 on TP-02, station 17") == set()


# --- drafting ---


def test_guide_streams_each_step_then_the_saved_guide(env) -> None:
    deps, kb = env
    events, guide = draft(deps, kb)
    steps = [(e.step, e.status) for e in events if e.type == "step"]
    assert steps[0] == ("understand", "started")
    assert ("write_guide", "done") in steps
    assert {s for s, _ in steps} == {
        "understand",
        "search_history",
        "search_manuals",
        "find_parts",
        "write_guide",
    }
    assert kb.guides.get(guide.id) is not None
    assert guide.status == "draft"
    assert guide.events[0].by == "Ravi"


def test_guide_offers_the_alarm_section_plus_safety_and_restart(env) -> None:
    _, guide = draft(*env)
    assert guide.asset_tag == "TP-02"
    assert guide.error_codes == ["E-104"]
    offered = {s.id for s in guide.manual_sections}
    assert {"MAN-RTP37-16", "MAN-RTP37-3", "MAN-RTP37-28"} <= offered
    assert {s.id for s in guide.sources} == offered | {m.id for m in guide.similar_incidents}


def test_guide_enforces_sources_values_and_figures(env) -> None:
    _, guide = draft(*env)
    first, torque, clean, general = guide.steps
    assert first.figure_id == "FIG-1" and not first.flags and not first.general
    # A figure is shown once; a value with a unit must be in a cited source.
    assert torque.figure_id is None
    assert any("25 nm" in f for f in torque.flags)
    # Invented ids are removed and flagged; inline ids leave the shop-floor text.
    assert clean.citations == ["MAN-RTP37-16"]
    assert any("MAN-RTP37-99" in f for f in clean.flags)
    assert "[" not in clean.text and clean.figure_id is None
    assert clean.caution == "Never use a metal brush."
    assert general.general and general.citations == []
    assert "[" not in guide.title and "[" not in guide.escalate_if[0]


def test_guide_parts_come_from_the_store_with_stock_warnings(env) -> None:
    _, guide = draft(*env)
    assert [p.part_no for p in guide.parts] == ["RTP-BS-07", "RTP-BT-04"]
    bushing, belt = guide.parts
    assert bushing.in_stock and bushing.bin_location == "" and bushing.name == "Guide bushing"
    assert not belt.in_stock
    flags = " ".join(guide.flags)
    assert "RTP-BS-07" in flags and "last one" in flags
    assert "RTP-BT-04" in flags and "purchase request" in flags
    assert "XX-1" in flags


def test_guide_time_estimate_comes_from_manual_and_history(env) -> None:
    _, guide = draft(*env)
    assert guide.downtime.manual_minutes == 45
    assert guide.downtime.manual_source == "MAN-RTP37-16"
    assert "45 min" in guide.downtime.note


def test_guide_without_a_manual_is_flagged(env) -> None:
    deps, kb = env
    kb.sections.clear()
    kb.codes.clear()
    deps.llm.responses[GuideContent] = CONTENT.model_copy(
        update={
            "steps": [GuideStepOut(text="Check it.", citations=[], caution=None, figure_id=None)]
        }
    )
    _, guide = draft(deps, kb, "Strange noise from the mixer.")
    assert guide.manual_sections == []
    assert any("No manual section" in f for f in guide.flags)
    assert "No manual section matched" in deps.llm.prompts[-1][1]


UNTAGGED = "The upper punch is sticking and the press stopped."


def no_machine_named(deps, equipment: str) -> None:
    deps.llm.incident = deps.llm.incident.model_copy(update={"area_or_equipment": equipment})


def test_report_without_a_machine_uses_the_manual_gemini_confirms(env) -> None:
    deps, kb = env
    no_machine_named(deps, "tablet press")
    deps.llm.responses[ManualPick] = ManualPick(manual_id="RTP37", why="Both are tablet presses.")
    _, guide = draft(deps, kb, UNTAGGED)
    assert {s.manual_id for s in guide.manual_sections} == {"RTP37"}
    assert "ManualPick" in [name for name, _ in deps.llm.prompts]
    # TP-01 and TP-02 share the manual, so the guide must not name one of them.
    assert guide.asset_tag is None
    assert guide.equipment_model == "Kestrel RTP-37 rotary tablet press"


@pytest.mark.parametrize("pick", [None, "MADE-UP"])
def test_report_for_other_equipment_gets_no_manual(env, pick) -> None:
    """A coating pan scores close to the tablet press manual; a wrong manual is worse than none."""
    deps, kb = env
    no_machine_named(deps, "coating pan")
    deps.llm.responses[ManualPick] = ManualPick(manual_id=pick, why="A coating pan, not a press.")
    _, guide = draft(deps, kb, "The coating pan spray gun keeps dripping.")
    assert guide.manual_sections == []
    assert guide.asset_tag is None
    assert any("No manual section" in f for f in guide.flags)
    assert guide.qa_reasons


def test_a_named_machine_skips_the_manual_check(env) -> None:
    deps, kb = env
    draft(deps, kb)
    assert "ManualPick" not in [name for name, _ in deps.llm.prompts]


def test_guide_list_reads_only_summary_fields_and_matches_the_full_guide(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    [row] = workflow.list_guides(kb)
    assert row == workflow.summarize(guide)
    assert row.flags > 0 and row.steps == len(guide.steps) and row.author == "Ravi"
    raw = kb.guides.fields(workflow._SUMMARY_FIELDS)[0]
    assert "manual_sections" not in raw and "translations" not in raw


# --- translation and workflow ---


def test_missing_tokens_accepts_indian_digits() -> None:
    assert missing_tokens("Run at 10 rpm with tool T-12.", "౧౦ rpm T-12 తో") == []
    assert missing_tokens("Run at 10 rpm with tool T-12.", "10 rpm తో") == ["T-12"]
    assert missing_tokens("Replace RTP-BS-07.", "RTP-BS-07 మార్చండి") == []


def test_submit_translates_and_flags_lost_codes(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    guide = workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    assert guide.status == "in_review"
    assert [t.language for t in guide.translations] == ["te", "hi"]
    te = guide.translations[0]
    assert te.language_name == "Telugu"
    assert len(te.steps) == len(guide.steps) == len(te.step_cautions)
    assert te.flags == ["Step 1: T-12 not found in the translation."]


def test_qa_cannot_review_own_submission_and_must_explain_a_rejection(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    with pytest.raises(workflow.GuideError) as own:
        workflow.review(guide.id, GuideReview(by=" ravi ", decision="approve"), kb)
    assert own.value.status_code == 403
    with pytest.raises(workflow.GuideError) as silent:
        workflow.review(guide.id, GuideReview(by="Sita", decision="reject", comment=" "), kb)
    assert silent.value.status_code == 422
    rejected = workflow.review(
        guide.id, GuideReview(by="Sita", decision="reject", comment="Add the gauge step"), kb
    )
    assert rejected.status == "rejected"


def test_edit_after_rejection_rechecks_and_bumps_version(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    workflow.review(guide.id, GuideReview(by="Sita", decision="reject", comment="Fix it"), kb)
    edit = GuideEdit(
        by="Ravi",
        title="TP-02 E-104",
        summary="Edited.",
        safety=guide.safety,
        steps=[
            *guide.steps,
            GuideStep(text="Check the bore at 99 mm.", citations=["MAN-RTP37-16"]),
        ],
        parts=[GuidePartPick(part_no="RTP-PN-U-10", qty=2)],
        restart_checks=guide.restart_checks,
    )
    edited = workflow.edit(guide.id, edit, kb)
    assert edited.status == "draft" and edited.version == 2
    assert edited.translations == []
    assert any("99 mm" in f for f in edited.steps[-1].flags)
    assert [p.part_no for p in edited.parts] == ["RTP-PN-U-10"]
    assert not any("RTP-BT-04" in f for f in edited.flags)


def test_only_approved_guides_print_and_close_saves_to_memory(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    with pytest.raises(workflow.GuideError):
        workflow.record_print(guide.id, GuideAction(by="Ravi"), kb)
    workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    workflow.review(guide.id, GuideReview(by="Sita", decision="approve"), kb)
    with pytest.raises(workflow.GuideError):
        workflow.edit(
            guide.id, GuideEdit(by="Ravi", title="x", summary="", safety=[], steps=guide.steps), kb
        )
    assert workflow.record_print(guide.id, GuideAction(by="Ravi"), kb).copies_printed == 1
    assert workflow.record_print(guide.id, GuideAction(by="Ravi"), kb).copies_printed == 2

    closed = workflow.close(
        guide.id,
        GuideClose(
            by="Ravi",
            action_taken="Replaced bushing RTP-BS-07.",
            root_cause="Worn bushing",
            downtime_minutes=150,
            parts_used="RTP-BS-07",
        ),
        deps,
        kb,
    )
    assert closed.status == "closed"
    record = deps.store.get(closed.closure_record_id)
    assert record.source == "guide_closure"
    assert record.area_or_equipment == "TP-02"
    assert record.description == REQUEST
    assert "Parts used: RTP-BS-07." in record.action_taken
    assert record.source_ref.startswith(guide.id)
    assert [e.action for e in closed.events] == [
        "created",
        "submitted",
        "approved",
        "printed",
        "printed",
        "closed",
    ]


def clean_edit(guide, keep_t12: bool = True) -> GuideEdit:
    """The draft with every flagged or unsourced line removed. The fake Telugu loses
    "T-12", so without step 1 nothing is left for QA to check."""
    steps = [s for s in guide.steps if not s.flags and not s.general]
    if not keep_t12:
        steps = [s for s in steps if "T-12" not in s.text]
    steps.append(GuideStep(text="Clean the bore.", citations=["MAN-RTP37-16"]))
    return GuideEdit(
        by="Ravi",
        title=guide.title,
        summary=guide.summary,
        safety=[i for i in guide.safety if not i.flags],
        steps=steps,
        restart_checks=[i for i in guide.restart_checks if not i.flags],
    )


def test_qa_reasons_explain_why_qa_must_approve(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    reasons = guide.qa_reasons
    assert reasons[0].startswith("Step 2: Check “25 nm”")
    assert "Step 4 is not from the manual or a past fix." in reasons
    assert workflow.qa_reasons(guide, "always")[0].startswith("This plant's setting")


def test_manager_approves_a_clean_guide_but_flagged_ones_go_to_qa(env) -> None:
    deps, kb = env
    _, flagged = draft(deps, kb)
    sent = workflow.approve(flagged.id, GuideAction(by="Ravi"), deps, kb)
    assert sent.status == "in_review"
    assert sent.events[-1].action == "submitted"
    assert sent.events[-1].comment.startswith("QA needed: ")

    _, guide = draft(deps, kb)
    workflow.edit(guide.id, clean_edit(guide, keep_t12=False), kb)
    approved = workflow.approve(guide.id, GuideAction(by="Ravi"), deps, kb)
    assert approved.status == "approved", approved.qa_reasons
    assert approved.qa_reasons == []
    assert [t.language for t in approved.translations] == ["te", "hi"]
    assert approved.events[-1].action == "approved" and approved.events[-1].by == "Ravi"


def test_a_lost_code_in_translation_sends_the_guide_to_qa(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    workflow.edit(guide.id, clean_edit(guide), kb)
    sent = workflow.approve(guide.id, GuideAction(by="Ravi"), deps, kb)
    assert sent.status == "in_review"
    assert "Telugu: 1 line may not match the English." in sent.qa_reasons


def test_qa_always_policy_sends_every_guide_to_qa(env) -> None:
    deps, kb = env
    deps.settings.qa_approval = "always"
    _, guide = draft(deps, kb)
    workflow.edit(guide.id, clean_edit(guide, keep_t12=False), kb)
    assert workflow.approve(guide.id, GuideAction(by="Ravi"), deps, kb).status == "in_review"


def test_qa_releases_the_machine_after_the_repair(env) -> None:
    deps, kb = env
    _, guide = draft(deps, kb)
    workflow.submit(guide.id, GuideAction(by="Ravi"), deps, kb)
    workflow.review(guide.id, GuideReview(by="Sita", decision="approve"), kb)
    with pytest.raises(workflow.GuideError):
        workflow.release(guide.id, GuideRelease(by="Sita", checks=list(RELEASE_CHECKS)), kb)
    workflow.close(guide.id, GuideClose(by="Ravi", action_taken="Freed the punch."), deps, kb)
    with pytest.raises(workflow.GuideError) as own:
        workflow.release(guide.id, GuideRelease(by="ravi", checks=list(RELEASE_CHECKS)), kb)
    assert own.value.status_code == 403
    with pytest.raises(workflow.GuideError) as unchecked:
        workflow.release(guide.id, GuideRelease(by="Sita", checks=list(RELEASE_CHECKS[:2])), kb)
    assert unchecked.value.status_code == 422
    released = workflow.release(guide.id, GuideRelease(by="Sita", checks=list(RELEASE_CHECKS)), kb)
    assert released.status == "released"
    assert released.events[-1].action == "released"


# --- API ---


def test_guide_api_flow(env) -> None:
    client = TestClient(app)
    with client.stream("POST", "/api/guides/stream", json={"text": REQUEST, "by": "Ravi"}) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        events = [json.loads(line[5:]) for line in r.iter_lines() if line.startswith("data:")]
    guide = events[-1]["guide"]
    gid = guide["id"]

    assert client.get("/api/guides").json()[0]["id"] == gid
    assert client.post(f"/api/guides/{gid}/print", json={"by": "Ravi"}).status_code == 409
    assert (
        client.post(f"/api/guides/{gid}/submit", json={"by": "Ravi"}).json()["status"]
        == "in_review"
    )
    own = client.post(f"/api/guides/{gid}/review", json={"by": "Ravi", "decision": "approve"})
    assert own.status_code == 403
    ok = client.post(f"/api/guides/{gid}/review", json={"by": "Sita", "decision": "approve"})
    assert ok.json()["status"] == "approved"
    assert client.get("/api/guides", params={"status": "approved"}).json()[0]["id"] == gid
    assert (
        client.post(f"/api/guides/{gid}/print", json={"by": "Ravi"}).json()["copies_printed"] == 1
    )
    assert client.get("/api/guides/GDE-NOPE").status_code == 404


def test_knowledge_base_api(env) -> None:
    client = TestClient(app)
    assert [a["tag"] for a in client.get("/api/assets").json()] == ["TP-01", "TP-02"]
    manuals = client.get("/api/manuals").json()
    assert manuals[0]["manual_id"] == "RTP37" and manuals[0]["error_codes"] == 2
    section = client.get("/api/manuals/sections/MAN-RTP37-16").json()
    assert section["repair_minutes"] == 45 and "embedding" not in section
    assert len(client.get("/api/manuals/RTP37/sections").json()) == 5
    assert len(client.get("/api/parts", params={"asset": "TP-02"}).json()) == 3
    image = client.get("/api/figures/FIG-1")
    assert image.content == PNG_BYTES and image.headers["content-type"] == "image/png"
    assert client.get("/api/figures/NOPE").status_code == 404
    config = client.get("/api/config").json()
    assert config["guide_languages"] == [
        {"code": "te", "name": "Telugu"},
        {"code": "hi", "name": "Hindi"},
    ]
