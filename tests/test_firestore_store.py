"""FirestoreStore logic with the Firestore client mocked (no network)."""

from datetime import date
from unittest.mock import MagicMock

import pytest
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from app.models import IncidentRecord
from app.store.firestore_store import (
    FirestoreStore,
    cosine_similarity,
    from_document,
    to_document,
)


def record(record_id: str = "PAP-0001", **overrides) -> IncidentRecord:
    fields = {
        "id": record_id,
        "industry": "paper",
        "date": date(2026, 6, 18),
        "area_or_equipment": "PM2",
        "description": "Web breaks",
        "embedding": [0.6, 0.8],
    }
    return IncidentRecord(**(fields | overrides))


def snapshot(data: dict) -> MagicMock:
    snap = MagicMock()
    snap.to_dict.return_value = data
    snap.exists = True
    return snap


def test_document_round_trip_uses_native_vector() -> None:
    original = record()
    doc = to_document(original)
    assert isinstance(doc["embedding"], Vector)
    assert doc["date"] == "2026-06-18"
    assert from_document(doc | {"vector_distance": 0.1}) == original


def test_cosine_distance_becomes_similarity() -> None:
    assert cosine_similarity(0.0) == 1.0
    assert cosine_similarity(0.25) == pytest.approx(0.75)


def test_search_filters_by_industry_and_converts_scores() -> None:
    client = MagicMock()
    store = FirestoreStore(client=client)
    collection = client.collection.return_value
    vector_query = collection.where.return_value.find_nearest.return_value
    vector_query.get.return_value = [
        snapshot(to_document(record("PAP-0001")) | {"vector_distance": 0.12}),
        snapshot(to_document(record("PAP-0002")) | {"vector_distance": 0.2}),
    ]

    hits = store.search([0.6, 0.8], k=2, industry="paper")

    assert [h.record.id for h in hits] == ["PAP-0001", "PAP-0002"]
    assert hits[0].score == pytest.approx(0.88)
    kwargs = collection.where.return_value.find_nearest.call_args.kwargs
    assert kwargs["distance_measure"] == DistanceMeasure.COSINE
    assert kwargs["limit"] == 2 and kwargs["vector_field"] == "embedding"
    assert collection.where.call_args.kwargs["filter"].field_path == "industry"


def test_search_without_industry_queries_whole_collection() -> None:
    client = MagicMock()
    store = FirestoreStore(client=client)
    collection = client.collection.return_value
    collection.find_nearest.return_value.get.return_value = []
    assert store.search([1.0, 0.0], k=5) == []
    collection.where.assert_not_called()


def test_upsert_batches_and_requires_embeddings() -> None:
    client = MagicMock()
    store = FirestoreStore(client=client)
    store.upsert([record(f"R-{i}") for i in range(450)])
    assert client.batch.return_value.commit.call_count == 2
    with pytest.raises(ValueError, match="no embedding"):
        store.upsert([record(embedding=[])])
