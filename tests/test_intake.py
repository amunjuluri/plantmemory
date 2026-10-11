"""Voice intake, machine logs, CMMS exports and manual uploads, with Gemini mocked."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent import tools
from app.config import ROOT_DIR
from app.intake import cmms, machine_logs, voice
from app.kb import manual_ingest, set_kb
from app.main import app
from app.models import (
    Asset,
    CmmsMapping,
    ErrorCodeOut,
    FigureBox,
    IntakeFields,
    IntakeState,
    IntakeTurnOut,
    LogEventOut,
    LogExtraction,
    ManualExtraction,
    ManualSectionOut,
)
from tests.fakes import MATCHING, FakeLLM, make_deps, make_kb

SAMPLES = ROOT_DIR / "data" / "samples"
ASSETS = [Asset(tag="TP-02", equipment_model="Kestrel RTP-37 rotary tablet press")]
WAV = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 32


@pytest.fixture
def env(tmp_path: Path):
    llm = FakeLLM()
    deps = make_deps(tmp_path, MATCHING, llm)
    kb = make_kb(tmp_path)
    tools.set_deps(deps)
    set_kb(kb)
    yield deps, kb
    tools.set_deps(None)
    set_kb(None)


# --- voice intake ---


@pytest.mark.parametrize(
    ("data", "mime"),
    [
        (b"\x1a\x45\xdf\xa3" + b"\x00" * 8, "audio/webm"),
        (b"OggS" + b"\x00" * 8, "audio/ogg"),
        (WAV, "audio/wav"),
        (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 8, "audio/mp4"),
        (b"ID3" + b"\x00" * 8, "audio/mpeg"),
    ],
)
def test_sniff_audio_type(data: bytes, mime: str) -> None:
    assert voice.sniff_audio_type(data) == mime


def test_sniff_audio_rejects_other_files() -> None:
    with pytest.raises(voice.InvalidAudioError):
        voice.sniff_audio_type(b"%PDF-1.7 not audio")


def test_intake_asks_for_what_is_missing_in_the_managers_language(env) -> None:
    deps, _ = env
    deps.llm.responses[IntakeTurnOut] = IntakeTurnOut(
        transcript="TP-02 ఆగిపోయింది",
        language="te",
        fields=IntakeFields(equipment="TP-02", machine_stopped=True),
        question="ఏ సమస్య కనిపిస్తోంది?",
    )
    result = voice.take_turn(IntakeState(), deps, ASSETS, audio=WAV)
    assert not result.done
    assert result.missing == ["symptom"]
    assert result.question == "ఏ సమస్య కనిపిస్తోంది?"
    assert [m.role for m in result.state.history] == ["manager", "assistant"]
    audio_part = deps.llm.prompts[-1][1][1]
    assert audio_part.inline_data.mime_type == "audio/wav"


def test_intake_keeps_earlier_fields_and_finishes_when_complete(env) -> None:
    deps, _ = env
    state = IntakeState(fields=IntakeFields(equipment="TP-02", machine_stopped=True), turns=1)
    deps.llm.responses[IntakeTurnOut] = IntakeTurnOut(
        transcript="E-104 punch tight",
        language="te",
        fields=IntakeFields(symptom="Punch tight", error_code="E-104"),
        question="anything else?",
    )
    result = voice.take_turn(state, deps, ASSETS, text="E-104 punch tight")
    assert result.done and result.question is None and result.missing == []
    assert result.state.fields.equipment == "TP-02"
    assert result.summary.startswith(
        "TP-02: Punch tight. Alarm E-104 on the screen. Machine stopped."
    )
    assert "Manager's words (Telugu)" in result.summary


def test_intake_uses_a_fallback_question_and_stops_after_max_turns(env) -> None:
    deps, _ = env
    deps.llm.responses[IntakeTurnOut] = IntakeTurnOut(
        transcript="hmm", language="en", fields=IntakeFields(), question=None
    )
    result = voice.take_turn(IntakeState(), deps, ASSETS, text="hmm")
    assert result.question == voice.FALLBACK_QUESTION["equipment"]
    late = voice.take_turn(IntakeState(turns=voice.MAX_TURNS - 1), deps, ASSETS, text="hmm")
    assert late.done and late.question is None


def test_closure_intake_needs_action_downtime_and_outcome(env) -> None:
    deps, _ = env
    deps.llm.responses[IntakeTurnOut] = IntakeTurnOut(
        transcript="Replaced the bushing, two and a half hours, fine now",
        language="en",
        fields=IntakeFields(
            action_taken="Replaced the bushing", downtime_minutes=150, outcome="resolved"
        ),
        question=None,
    )
    result = voice.take_turn(IntakeState(mode="closure"), deps, ASSETS, text="...")
    assert result.done
    assert result.summary == "Done: Replaced the bushing. Downtime 2 h 30 min. Fixed."


def test_intake_api_takes_text_and_rejects_bad_state(env) -> None:
    deps, _ = env
    deps.llm.responses[IntakeTurnOut] = IntakeTurnOut(
        transcript="TP-02 stopped, E-104",
        language="en",
        fields=IntakeFields(equipment="TP-02", symptom="Punch tight", machine_stopped=True),
        question=None,
    )
    client = TestClient(app)
    ok = client.post(
        "/api/intake/turn", data={"state": IntakeState().model_dump_json(), "text": "TP-02 stopped"}
    )
    assert ok.status_code == 200 and ok.json()["done"] is True
    bad = client.post("/api/intake/turn", data={"state": "{not json", "text": "x"})
    assert bad.status_code == 422
    noise = client.post(
        "/api/intake/turn",
        data={"state": IntakeState().model_dump_json()},
        files={"audio": ("a.bin", b"%PDF-1.7", "application/octet-stream")},
    )
    assert noise.status_code == 415


# --- machine logs ---


def test_severity_from_labels_numbers_and_codes() -> None:
    assert machine_logs.severity_of("Errors", None, "") == "error"
    assert machine_logs.severity_of("Warnings", None, "") == "warning"
    assert machine_logs.severity_of("System", None, "") == "info"
    assert machine_logs.severity_of("800", None, "") == "error"
    assert machine_logs.severity_of("400", None, "") == "warning"
    assert machine_logs.severity_of("", "W-212", "") == "warning"
    assert machine_logs.severity_of("", None, "Fault: motor") == "error"


def test_hmi_alarm_table_splits_errors_and_warnings(env) -> None:
    deps, kb = env
    data = (SAMPLES / "alarm_log_tp02.csv").read_bytes()
    result = machine_logs.analyze_log(data, "alarm_log_tp02.csv", deps, kb)
    assert result.parser == "table"
    assert result.asset_tag == "TP-02"
    assert [e.code for e in result.errors] == ["E-104"]
    error = result.errors[0]
    assert error.stops_machine and error.count == 1
    assert error.manual.section_id == "MAN-RTP37-16"
    assert error.downtime.manual_minutes == 45
    assert error.immediate_actions == ["Lock out the press"]
    assert "TP-02: alarm E-104" in error.guide_prompt and "W-212" in error.guide_prompt
    w212 = next(w for w in result.warnings if w.code == "W-212")
    assert w212.count == 19 and not w212.stops_machine
    assert "rising" in w212.trend and "comes before E-104" in w212.trend
    assert result.info_events == 3
    # Codes the manual does not list are reported, not explained.
    assert any("W-401" in n for n in result.notes)


def test_unknown_log_formats_are_read_by_the_model(env) -> None:
    deps, kb = env
    deps.llm.responses[LogExtraction] = LogExtraction(
        equipment="TP-02",
        events=[
            LogEventOut(timestamp="2026-10-12T06:00:00", message="Login", severity="info"),
            LogEventOut(
                timestamp="2026-10-12T06:30:00",
                code="E104",
                message="Punch tight",
                severity="error",
            ),
        ],
    )
    data = b"06:00 operator login\n06:30 !! E104 punch tight, press halted\n"
    result = machine_logs.analyze_log(data, "printout.txt", deps, kb)
    assert result.parser == "ai"
    assert result.asset_tag == "TP-02"
    assert result.errors[0].code == "E-104"
    assert result.errors[0].manual is not None


def test_binary_files_are_not_logs(env) -> None:
    deps, kb = env
    with pytest.raises(machine_logs.InvalidLogError):
        machine_logs.analyze_log(b"\x00\x01\x02" * 100, "x.bin", deps, kb)


def test_logs_api(env) -> None:
    data = (SAMPLES / "alarm_log_tp02.csv").read_bytes()
    response = TestClient(app).post(
        "/api/logs/analyze", files={"file": ("alarm_log_tp02.csv", data, "text/csv")}
    )
    assert response.status_code == 200
    assert response.json()["errors"][0]["code"] == "E-104"


# --- CMMS exports ---

SAP_MAPPING = CmmsMapping(
    system="SAP PM notification list",
    id_column="Notification",
    date_column="Malfunct.start",
    equipment_columns=["Equipment descr.", "Made-up column"],
    description_columns=["Description", "Damage code text"],
    cause_columns=["Cause text"],
    action_columns=["Activity text"],
    downtime_column="Breakdown dur.",
    downtime_unit="hours",
    status_column="System status",
    completed_values=["NOCO"],
)


def test_parse_minutes_and_dates() -> None:
    assert cmms.parse_minutes("1,5", "hours") == 90
    assert cmms.parse_minutes("1:30", "hours") == 90
    assert cmms.parse_minutes("45", "minutes") == 45
    assert cmms.parse_minutes("", "hours") is None
    assert str(cmms.parse_date("03.09.2025")) == "2025-09-03"
    assert str(cmms.parse_date("2025-09-03 10:00")) == "2025-09-03"
    assert cmms.parse_date("soon") is None


def test_sap_export_maps_every_row_exactly(env) -> None:
    deps, _ = env
    deps.llm.responses[CmmsMapping] = SAP_MAPPING
    data = (SAMPLES / "sap_iw29_export.csv").read_bytes()
    result = cmms.import_export(data, "sap_iw29_export.csv", deps)
    assert result.mapping.equipment_columns == ["Equipment descr."]  # made-up column dropped
    assert result.rows == 12 and len(result.records) == 11
    assert result.skipped == ["Row 11: no readable date."]
    first = result.records[0]
    assert first.id == "CMMS-10004512"
    assert first.description == "Upper punch tight stn 9, press stopped. Punch binding"
    assert first.area_or_equipment == "Tablet press TP-02"
    assert first.downtime_minutes == 72
    assert first.outcome == "resolved" and first.source == "cmms_import"
    again = next(r for r in result.records if r.id == "CMMS-10004790")
    assert again.outcome == "recurred"  # "Door seal fault again"
    open_one = result.records[-1]
    assert open_one.outcome == "unknown" and open_one.confidence_flags == ["outcome"]


def test_mapping_without_a_real_date_column_is_refused(env) -> None:
    deps, _ = env
    deps.llm.responses[CmmsMapping] = SAP_MAPPING.model_copy(update={"date_column": "When"})
    with pytest.raises(cmms.InvalidExportError):
        cmms.import_export((SAMPLES / "sap_iw29_export.csv").read_bytes(), "x.csv", deps)


def test_xlsx_exports_are_read(tmp_path: Path) -> None:
    from openpyxl import Workbook

    book = Workbook()
    book.active.append(["Notification", "Date", "Text"])
    book.active.append([1001, "2026-01-02", "Pump trip"])
    path = tmp_path / "export.xlsx"
    book.save(path)
    header, rows = cmms.read_rows(path.read_bytes(), "export.xlsx")
    assert header == ["Notification", "Date", "Text"]
    assert rows == [{"Notification": "1001", "Date": "2026-01-02", "Text": "Pump trip"}]


def test_cmms_import_then_confirm_saves_with_cmms_source(env) -> None:
    deps, _ = env
    deps.llm.responses[CmmsMapping] = SAP_MAPPING
    client = TestClient(app)
    data = (SAMPLES / "sap_iw29_export.csv").read_bytes()
    imported = client.post("/api/ingest/cmms", files={"file": ("sap.csv", data, "text/csv")}).json()
    saved = client.post("/api/ingest/confirm", json={"records": imported["records"][:2]})
    assert saved.status_code == 201
    assert {r["source"] for r in saved.json()} == {"cmms_import"}
    assert deps.store.get("CMMS-10004512").source == "cmms_import"


# --- manual upload ---


def manual_extraction() -> ManualExtraction:
    return ManualExtraction(
        title="Aerodry FBD-120 manual",
        equipment_model="Aerodry FBD-120",
        sections=[
            ManualSectionOut(page=2, title="Safety", kind="safety", text="Lock QS1."),
            ManualSectionOut(
                page=5,
                title="E-15 Filter dP high",
                kind="troubleshooting",
                text="Replace bags FBD-FB-120. Typical time: 60 minutes.",
                error_codes=["E-15"],
                repair_minutes=60,
                figures=[
                    FigureBox(caption="Filter bag", box_2d=[300, 200, 700, 700]),
                    FigureBox(caption="tiny logo", box_2d=[0, 0, 10, 10]),
                ],
            ),
        ],
        error_codes=[
            ErrorCodeOut(
                code="E-15", title="Filter dP high", severity="error", stops_machine=True, page=5
            ),
            ErrorCodeOut(
                code="W-08",
                title="Filter dP rising",
                severity="warning",
                stops_machine=False,
                page=4,
            ),
        ],
    )


def test_manual_upload_stores_sections_codes_and_cropped_figures(env) -> None:
    deps, kb = env
    deps.llm.responses[ManualExtraction] = manual_extraction()
    pdf = (SAMPLES / "manual_fbd120.pdf").read_bytes()
    result = manual_ingest.ingest_manual(pdf, "manual_fbd120.pdf", ["FBD-1"], deps, kb)
    assert result.summary.manual_id == "FBD120"
    assert result.summary.asset_tags == ["FBD-1"]
    assert [s.id for s in result.sections] == ["MAN-FBD120-2", "MAN-FBD120-5"]
    assert result.sections[1].figure_ids == ["FIG-FBD120-P5-1"]  # the tiny box is skipped
    figure = kb.figures.get("FIG-FBD120-P5-1")
    assert figure.mime == "image/jpeg" and figure.caption == "Filter bag"
    codes = {c.code: c.section_id for c in kb.codes.all(manual_id="FBD120")}
    assert codes == {"E-15": "MAN-FBD120-5", "W-08": None}
    assert deps.llm.prompts[-1][1][0].inline_data.mime_type == "application/pdf"

    # Uploading again replaces the manual instead of duplicating it.
    manual_ingest.ingest_manual(pdf, "manual_fbd120.pdf", ["FBD-1"], deps, kb)
    assert len(kb.sections.all(manual_id="FBD120")) == 2
    assert manual_ingest.delete_manual("FBD120", kb) == 2
    assert kb.figures.get("FIG-FBD120-P5-1") is None


def test_manual_upload_rejects_non_pdfs(env) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/manuals/upload", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}
    )
    assert response.status_code == 415
    assert client.delete("/api/manuals/NOPE").status_code == 404


def test_parse_tags() -> None:
    assert manual_ingest.parse_tags("tp-01, TP-02;tp-01") == ["TP-01", "TP-02"]
    assert manual_ingest.parse_tags(None) == []


def test_samples_are_served(env) -> None:
    client = TestClient(app)
    for name in (
        "alarm_log_tp02.csv",
        "cycle_log_ac2.txt",
        "sap_iw29_export.csv",
        "manual_fbd120.pdf",
    ):
        assert client.get(f"/samples/{name}").status_code == 200
    assert json.loads(client.get("/api/config").content)["store_backend"] in {"local", "firestore"}


VAGUE = ["Machine stopped", "stopped", "not working", "The press has stopped."]


@pytest.mark.parametrize("symptom", VAGUE)
def test_a_stop_alone_is_not_a_symptom(env, symptom: str) -> None:
    deps, _ = env
    deps.llm.responses[IntakeTurnOut] = IntakeTurnOut(
        transcript="x",
        language="hi",
        fields=IntakeFields(equipment="BL-3", symptom=symptom, machine_stopped=True),
        question=None,
    )
    result = voice.take_turn(IntakeState(), deps, ASSETS, text="x")
    assert not result.done and result.missing == ["symptom"]
    assert result.question == voice.FALLBACK_QUESTION["symptom"]
