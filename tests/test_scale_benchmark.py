"""The scale benchmark's pure parts: turning an openFDA report into a past repair, and
refusing to write anywhere but its own collections."""

import pytest

from scripts.scale_benchmark import (
    MAX_DESCRIPTION,
    collection_name,
    maude_to_record,
    scale_store,
)


def report(**overrides) -> dict:
    base = {
        "mdr_report_key": "24582297",
        "date_of_event": "20260210",
        "date_received": "20260301",
        "device": [
            {
                "device_report_product_code": "FLE",
                "generic_name": "STERILIZER, STEAM",
                "brand_name": "CENTURY 60-INCH",
                "manufacturer_d_name": "STERIS",
            }
        ],
        "mdr_text": [
            {
                "text_type_code": "Description of Event or Problem",
                "text": "STEAM LEAKED FROM THE TOP OF THE   DOOR SEAL DURING A BOWIE-DICK TEST.",
            },
            {
                "text_type_code": "Additional Manufacturer Narrative",
                "text": "A TECHNICIAN REPLACED THE DOOR SEAL AND RETURNED THE UNIT TO SERVICE.",
            },
        ],
    }
    return {**base, **overrides}


def test_maps_a_report_like_the_seed_records():
    record = maude_to_record(report())
    assert record is not None
    assert record.id == "MDR-24582297"
    assert record.industry == "healthcare"
    assert record.source == "public_record"
    assert record.outcome == "unknown"
    assert str(record.date) == "2026-02-10"
    assert record.area_or_equipment == "Sterilizer, steam, CENTURY 60-INCH"
    assert record.description.startswith("STEAM LEAKED FROM THE TOP OF THE DOOR SEAL")
    assert "REPLACED THE DOOR SEAL" in record.action_taken
    assert record.source_ref.endswith("mdrfoi__id=24582297&pc=FLE")
    assert record.embedding is None


def test_skips_reports_without_a_usable_description():
    short = [{"text_type_code": "Description of Event or Problem", "text": "(B)(4)."}]
    assert maude_to_record(report(mdr_text=short)) is None
    assert maude_to_record(report(mdr_text=[])) is None
    assert maude_to_record(report(mdr_report_key=None)) is None


def test_falls_back_to_the_received_date_and_skips_undated_reports():
    assert str(maude_to_record(report(date_of_event="20261399")).date) == "2026-03-01"
    assert maude_to_record(report(date_of_event=None, date_received=None)) is None


def test_long_text_is_cut_at_a_word():
    long = [{"text_type_code": "Description of Event or Problem", "text": "word " * 400}]
    record = maude_to_record(report(mdr_text=long))
    assert len(record.description) <= MAX_DESCRIPTION + 4
    assert record.description.endswith("word ...")
    assert record.action_taken is None


def test_uses_brand_or_maker_and_product_label_when_names_are_missing():
    device = [{"device_report_product_code": "BTI", "manufacturer_d_name": "ACME"}]
    record = maude_to_record(report(device=device))
    assert record.area_or_equipment == "Portable air compressor, ACME"


def test_only_scale_collections_can_be_opened():
    assert collection_name(17) == "scale_incidents_17"
    assert collection_name(50000) == "scale_incidents_50k"
    for name in ("incidents", "guides", "manual_sections", "scale_incidents", "scaleincidents_1k"):
        with pytest.raises(ValueError):
            scale_store(name)
