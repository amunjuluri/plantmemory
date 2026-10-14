"""Live voice intake: what code decides while Gemini Live talks (no network)."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.intake.live import LiveSession, instructions, vocabulary
from app.main import app
from app.models import Asset, Guide, GuidePart, GuideStep, StructuredIncident

ASSETS = [
    Asset(tag="TP-01", equipment_model="Kestrel RTP-37 rotary tablet press", manual_id="RTP37"),
    Asset(tag="TP-02", equipment_model="Kestrel RTP-37 rotary tablet press", manual_id="RTP37"),
]


def guide() -> Guide:
    return Guide(
        id="GDE-TEST",
        status="approved",
        request="TP-01 die table jammed, E-103.",
        incident=StructuredIncident(
            industry="pharma",
            date="2026-10-11",
            area_or_equipment="TP-01",
            description="Die table jammed.",
        ),
        asset_tag="TP-01",
        error_codes=["E-103"],
        title="TP-01 E-103: clear the jammed die table",
        summary="",
        steps=[GuideStep(text="Turn the turret by hand with handwheel H1.")],
        parts=[GuidePart(part_no="RTP-PN-U-10", name="Upper punch")],
        created_at=datetime.now(UTC) - timedelta(minutes=95),
    )


def test_spoken_tags_become_the_plants_tag_and_code_decides_what_is_missing() -> None:
    live = LiveSession(mode="breakdown", assets=ASSETS)
    answer = live.update({"equipment": "tp 1", "machine_stopped": True, "language": "te"})
    assert live.state.fields.equipment == "TP-01"
    assert live.state.language == "te"
    assert answer["missing"] == "what is wrong"
    live.update({"symptom": "stopped"})  # a symptom must say what is wrong
    assert live.missing() == ["symptom"]
    done = live.update({"symptom": "Die table jammed", "error_code": "E-103"})
    assert done["missing"] == "nothing"
    assert "TP-01: Die table jammed." in done["report"]


def test_values_of_the_wrong_type_are_dropped_not_fatal() -> None:
    live = LiveSession(mode="closure", assets=ASSETS)
    live.update(
        {"downtime_minutes": "about ninety", "outcome": "maybe", "action_taken": "Freed it"}
    )
    assert live.state.fields.action_taken == "Freed it"
    assert live.state.fields.downtime_minutes is None
    assert live.state.fields.outcome is None
    live.update({"downtime_minutes": 92.6, "outcome": "resolved"})
    assert live.state.fields.downtime_minutes == 93


def test_a_vague_closure_is_not_complete_and_guide_parts_must_be_answered() -> None:
    live = LiveSession(mode="closure", assets=ASSETS, guide=guide())
    live.update(
        {"action_taken": "as the guide said", "downtime_minutes": 95, "outcome": "resolved"}
    )
    assert live.missing() == ["action_taken", "parts_used"]
    assert live.confirm()["status"] == "incomplete"
    assert not live.confirmed
    live.update(
        {"action_taken": "Followed guide GDE-TEST: freed the die table.", "parts_used": "None"}
    )
    assert live.missing() == []
    assert live.confirm()["status"] == "ok" and live.confirmed
    assert "press Save" in live.confirm()["message"]


def test_following_the_whole_guide_fills_its_parts_and_asks_to_name_them() -> None:
    live = LiveSession(mode="closure", assets=ASSETS, guide=guide())
    done = live.update(
        {
            "action_taken": "Followed guide GDE-TEST: freed the die table.",
            "downtime_minutes": 95,
            "outcome": "resolved",
        }
    )
    assert live.state.fields.parts_used == "RTP-PN-U-10 Upper punch x1"
    assert done["missing"] == "nothing"
    assert "RTP-PN-U-10 Upper punch x1" in done["guidance"]
    assert "Parts used: RTP-PN-U-10 Upper punch x1." in done["report"]
    # A correction replaces what code filled in.
    live.update({"parts_used": "None"})
    assert live.state.fields.parts_used == "None"


def test_only_some_steps_done_still_asks_which_parts_were_used() -> None:
    live = LiveSession(mode="closure", assets=ASSETS, guide=guide())
    live.update({"action_taken": "Followed steps 1 to 2 of guide GDE-TEST: cleaned the punches."})
    assert live.state.fields.parts_used is None
    assert "parts_used" in live.missing()


def test_closure_instructions_carry_the_guide_and_the_time_since_it_was_drafted() -> None:
    live = LiveSession(mode="closure", assets=ASSETS, guide=guide())
    text = instructions(live)
    assert "1. Turn the turret by hand with handwheel H1." in text
    assert "RTP-PN-U-10 Upper punch x1" in text
    assert "drafted 1 h 35 min ago" in text
    assert vocabulary(live, ["E-104"]) == ["TP-01", "TP-02", "E-104", "RTP-PN-U-10", "E-103"]


def test_transcripts_become_history_turn_by_turn() -> None:
    live = LiveSession(mode="breakdown", assets=ASSETS)
    live.heard("TP 1 ")
    live.heard("aagipoyindi")
    live.said("ఏమైంది?")
    live.end_turn()
    assert [(m.role, m.text) for m in live.state.history] == [
        ("manager", "TP 1 aagipoyindi"),
        ("assistant", "ఏమైంది?"),
    ]


def test_live_socket_refuses_other_sites() -> None:
    client = TestClient(app)
    with client.websocket_connect(
        "/api/intake/live", headers={"origin": "https://evil.example"}
    ) as ws:
        assert ws.receive_json() == {
            "type": "error",
            "message": "Voice is only available on this site.",
        }
