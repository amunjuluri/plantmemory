from datetime import date
from pathlib import Path

import pytest

from app.models import IncidentRecord
from app.store.local_store import LocalStore


def make_record(record_id: str, vector: list[float], **overrides) -> IncidentRecord:
    fields = {
        "id": record_id,
        "industry": "generic",
        "date": date(2026, 1, 1),
        "area_or_equipment": "Line 1",
        "description": f"Incident {record_id}",
        "embedding": vector,
    }
    return IncidentRecord(**(fields | overrides))


@pytest.fixture
def store(tmp_path: Path) -> LocalStore:
    return LocalStore(tmp_path / "incidents.json")


def test_search_ranks_by_cosine_similarity(store: LocalStore) -> None:
    store.upsert(
        [
            make_record("near", [1.0, 0.1, 0.0]),
            make_record("far", [0.0, 0.0, 1.0]),
            make_record("mid", [0.6, 0.6, 0.0]),
        ]
    )
    hits = store.search([1.0, 0.0, 0.0], k=2)
    assert [h.record.id for h in hits] == ["near", "mid"]
    assert hits[0].score == pytest.approx(0.995, abs=1e-3)
    assert hits[0].score > hits[1].score


def test_search_is_scale_invariant(store: LocalStore) -> None:
    store.upsert([make_record("a", [2.0, 0.0])])
    assert store.search([10.0, 0.0], k=1)[0].score == pytest.approx(1.0)


def test_search_filters_by_industry(store: LocalStore) -> None:
    store.upsert(
        [
            make_record("paper", [1.0, 0.0], industry="paper"),
            make_record("pharma", [1.0, 0.0], industry="pharma"),
        ]
    )
    hits = store.search([1.0, 0.0], k=5, industry="pharma")
    assert [h.record.id for h in hits] == ["pharma"]


def test_search_on_empty_store_returns_nothing(store: LocalStore) -> None:
    assert store.search([1.0, 0.0], k=3) == []


def test_upsert_replaces_same_id(store: LocalStore) -> None:
    store.upsert([make_record("x", [1.0, 0.0], description="old")])
    store.upsert([make_record("x", [1.0, 0.0], description="new")])
    assert store.count() == 1
    assert store.get("x").description == "new"


def test_upsert_requires_embedding(store: LocalStore) -> None:
    with pytest.raises(ValueError, match="no embedding"):
        store.upsert([make_record("x", [])])


def test_records_persist_across_instances(tmp_path: Path) -> None:
    path = tmp_path / "incidents.json"
    LocalStore(path).upsert([make_record("x", [0.5, 0.5], outcome="recurred")])
    reloaded = LocalStore(path).get("x")
    assert reloaded is not None
    assert reloaded.outcome == "recurred"
    assert reloaded.embedding == [0.5, 0.5]


def test_list_is_newest_first_and_paginated(store: LocalStore) -> None:
    store.upsert([make_record(f"r{m}", [1.0, 0.0], date=date(2026, m, 1)) for m in range(1, 6)])
    assert [r.id for r in store.list_records(offset=0, limit=2)] == ["r5", "r4"]
    assert [r.id for r in store.list_records(offset=2, limit=2)] == ["r3", "r2"]
    assert store.count() == 5


def test_clear_removes_everything(store: LocalStore) -> None:
    store.upsert([make_record("x", [1.0])])
    store.clear()
    assert store.count() == 0
