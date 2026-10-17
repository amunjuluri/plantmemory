"""The scale benchmark's pure parts: turning an openFDA report into a past repair,
refusing to write anywhere but its own collections, and scoring with the judgements."""

import json

import pytest

from scripts.eval_retrieval import score_outcomes
from scripts.scale_benchmark import (
    CASES_PATH,
    JUDGEMENTS_PATH,
    MAX_DESCRIPTION,
    case_hits,
    collection_name,
    judged_spec,
    maude_to_record,
    scale_store,
    unjudged,
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


def test_judgements_cover_the_eval_and_never_contradict_themselves():
    spec = json.loads(CASES_PATH.read_text())
    judged = json.loads(JUDGEMENTS_PATH.read_text())["judged"]
    ids = {i["id"] for i in spec["cases"] + spec["negatives"]}
    assert set(judged) <= ids
    for q, j in judged.items():
        assert not set(j["same"]) & set(j["not_same"]), q
        assert set(j.get("why_not", {})) <= set(j["not_same"]), q
        assert all(why for why in j["same"].values()), q


def test_judged_records_join_the_eval_answers():
    spec = judged_spec()
    items = {i["id"]: i for i in spec["cases"] + spec["negatives"]}
    original = json.loads(CASES_PATH.read_text())
    q10 = next(c for c in original["cases"] if c["id"] == "Q10")
    assert set(q10["expected"]) < set(items["Q10"]["expected"])
    assert "MDR-590744" in items["Q10"]["expected"]  # a real positive-BI report
    assert "MDR-1148229" in items["N10"]["expected"]  # a real broken cart wheel
    assert items["N1"]["expected"] == []


def test_a_shown_record_nobody_judged_is_reported():
    spec = judged_spec()
    shown = {"Q10": ["MDR-2870708", "MDR-590744", "MDR-0"], "N1": ["MDR-134459"]}
    assert unjudged(spec, shown) == {"Q10": ["MDR-0"]}


def test_case_hits_counts_a_judged_record_as_right():
    hits = case_hits(["A", "B"], ["X", "B", "Y", "Z", "W"])
    assert hits == {"top1": False, "top3": True, "top5_hit": True, "expected_in_top5": 1}
    assert case_hits(["A"], [])["top1"] is False


def test_showing_a_judged_match_first_for_a_negative_is_not_a_false_alarm():
    negatives = [
        {"id": "N1", "kind": "unrelated"},
        {"id": "N10", "kind": "look-alike", "expected": ["MDR-1148229"]},
        {"id": "N11", "kind": "look-alike", "expected": ["MDR-1"]},
    ]
    shown = [["MDR-9"], ["MDR-1148229", "MDR-9"], ["MDR-9", "MDR-1"]]
    outcome = score_outcomes([], negatives, shown)
    assert [n["id"] for n, _ in outcome["alarms"]] == ["N1", "N11"]
    assert outcome["look_alike_alarms"] == 1
