"""Logbook photo ingest with Gemini mocked."""

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent import tools
from app.ingest import logbook_ocr
from app.main import app
from app.models import ExtractedIncident, LogbookExtraction
from tests.fakes import MATCHING, FakeLLM, make_deps

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64

PAGE = LogbookExtraction(
    records=[
        ExtractedIncident(
            industry="paper",
            date=date(2026, 10, 3),
            area_or_equipment="PM2 (paper machine 2) PR2 (second press)",
            description="web brk (sheet break) x3 after PR2 (second press), felt glazed",
            action_taken="F/W (felt wash)",
            outcome="resolved",
            downtime_minutes=45,
            confidence_flags=["downtime_minutes", "made_up_field"],
        ),
        ExtractedIncident(
            area_or_equipment="Wind[?]r",
            description="core chuck slipping",
        ),
    ],
    page_notes="Bottom of the page is torn.",
)


@pytest.fixture
def deps(tmp_path: Path):
    llm = FakeLLM()
    llm.extraction = PAGE
    d = make_deps(tmp_path, MATCHING, llm)
    tools.set_deps(d)
    yield d
    tools.set_deps(None)


@pytest.mark.parametrize(
    ("data", "mime"),
    [
        (JPEG, "image/jpeg"),
        (PNG, "image/png"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
        (b"\x00\x00\x00\x18ftypheic\x00\x00", "image/heic"),
    ],
)
def test_sniff_image_type(data: bytes, mime: str) -> None:
    assert logbook_ocr.sniff_image_type(data) == mime


def test_sniff_rejects_non_images_and_large_files() -> None:
    with pytest.raises(logbook_ocr.InvalidImageError):
        logbook_ocr.sniff_image_type(b"%PDF-1.7 not an image")
    with pytest.raises(logbook_ocr.InvalidImageError, match="larger"):
        logbook_ocr.sniff_image_type(PNG + b"\x00" * logbook_ocr.MAX_IMAGE_BYTES)


def test_glossary_merges_generic_with_industry(tmp_path: Path) -> None:
    (tmp_path / "generic.json").write_text(json.dumps({"B/D": "breakdown"}))
    (tmp_path / "paper.json").write_text(json.dumps({"PR2": "second press"}))
    (tmp_path / "pharma.json").write_text(json.dumps({"OOS": "out of specification"}))
    assert set(logbook_ocr.load_glossary("paper", tmp_path)) == {"B/D", "PR2"}
    assert set(logbook_ocr.load_glossary(None, tmp_path)) == {"B/D", "PR2", "OOS"}
    assert logbook_ocr.load_glossary(None, tmp_path / "missing") == {}


def test_extract_builds_reviewable_records(deps) -> None:
    today = date(2026, 10, 10)
    result = logbook_ocr.extract_records(PNG, "../../shift log 3.png", deps, today=today)
    first, second = result.records
    assert result.source_ref == "shift log 3.png"
    assert result.page_notes == "Bottom of the page is torn."
    assert first.id.startswith("LOG-") and first.source == "logbook_photo"
    assert first.confidence_flags == ["downtime_minutes"]  # unknown field names dropped
    # No readable date: filled with today and flagged; an unreadable word flags its field.
    assert second.date == today
    assert set(second.confidence_flags) == {"date", "area_or_equipment"}
    assert deps.store.count() == 3  # nothing saved yet


def test_extract_sends_photo_and_glossary_to_model(deps) -> None:
    logbook_ocr.extract_records(JPEG, "p.jpg", deps, industry="paper")
    schema, contents = deps.llm.prompts[-1]
    photo, prompt = contents
    assert schema == "LogbookExtraction"
    assert photo.inline_data.mime_type == "image/jpeg"
    assert "- PR2: second press" in prompt
    assert "OOS" not in prompt  # pharma glossary not included for a paper upload


def test_logbook_endpoint_then_confirm_saves_records(deps) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/ingest/logbook",
        files={"file": ("page.png", PNG, "image/png")},
        data={"industry": "paper"},
    )
    assert response.status_code == 200, response.text
    extracted = response.json()
    assert len(extracted["records"]) == 2
    assert all(r["industry"] == "paper" for r in extracted["records"])
    assert deps.store.count() == 3

    reviewed = extracted["records"]
    reviewed[1]["area_or_equipment"] = "Winder"
    reviewed[1]["confidence_flags"] = []
    saved = client.post("/api/ingest/confirm", json={"records": reviewed})
    assert saved.status_code == 201, saved.text
    assert deps.store.count() == 5
    stored = deps.store.get(reviewed[1]["id"])
    assert stored.area_or_equipment == "Winder"
    assert stored.source == "logbook_photo" and stored.embedding


def test_logbook_endpoint_rejects_non_image(deps) -> None:
    response = TestClient(app).post(
        "/api/ingest/logbook", files={"file": ("notes.pdf", b"%PDF-1.7", "application/pdf")}
    )
    assert response.status_code == 415


def test_confirm_refuses_to_overwrite_other_records(deps) -> None:
    record = deps.store.get("PAP-0001").model_dump(mode="json", exclude={"embedding"})
    record["description"] = "overwritten"
    response = TestClient(app).post("/api/ingest/confirm", json={"records": [record]})
    assert response.status_code == 422
    assert deps.store.get("PAP-0001").description != "overwritten"
