"""Firestore store with native vector search (`find_nearest`). Used on Cloud Run.

Needs two indexes (scripts/deploy.sh creates them):
- a vector index on `embedding` (flat, cosine-ready, EMBEDDING_DIM dimensions), and
- the same with `industry` first, for searches filtered by industry.
"""

from collections.abc import Iterable

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from app.models import IncidentRecord, Industry
from app.store.base import IncidentStore, SearchHit

_BATCH = 400  # Firestore allows 500 writes per batch.
_DISTANCE_FIELD = "vector_distance"


def to_document(record: IncidentRecord) -> dict:
    """A record as a Firestore document: JSON-safe fields plus a native Vector."""
    data = record.model_dump(mode="json", exclude={"embedding"})
    data["embedding"] = Vector(record.embedding or [])
    return data


def from_document(data: dict) -> IncidentRecord:
    """A Firestore document back into a record."""
    data = dict(data)
    data.pop(_DISTANCE_FIELD, None)
    vector = data.get("embedding")
    if vector is not None and not isinstance(vector, list):
        data["embedding"] = list(vector)
    return IncidentRecord.model_validate(data)


def cosine_similarity(distance: float) -> float:
    """Firestore's COSINE distance is 1 - cosine similarity, in [0, 2]."""
    return 1.0 - distance


class FirestoreStore(IncidentStore):
    """Incidents in one Firestore collection, one document per record id."""

    def __init__(
        self,
        database: str = "(default)",
        collection: str = "incidents",
        project: str | None = None,
        client: firestore.Client | None = None,
    ):
        self.client = client or firestore.Client(project=project, database=database)
        self.collection = self.client.collection(collection)

    def _query(self, industry: Industry | None):
        if industry is None:
            return self.collection
        return self.collection.where(filter=FieldFilter("industry", "==", industry))

    def upsert(self, records: Iterable[IncidentRecord]) -> None:
        records = list(records)
        for record in records:
            if not record.embedding:
                raise ValueError(f"Record {record.id} has no embedding")
        for start in range(0, len(records), _BATCH):
            batch = self.client.batch()
            for record in records[start : start + _BATCH]:
                batch.set(self.collection.document(record.id), to_document(record))
            batch.commit()

    def get(self, record_id: str) -> IncidentRecord | None:
        snapshot = self.collection.document(record_id).get()
        return from_document(snapshot.to_dict()) if snapshot.exists else None

    def list_records(
        self, offset: int = 0, limit: int = 20, industry: Industry | None = None
    ) -> list[IncidentRecord]:
        query = (
            self._query(industry)
            .order_by("date", direction=firestore.Query.DESCENDING)
            .offset(offset)
            .limit(limit)
        )
        return [from_document(s.to_dict()) for s in query.stream()]

    def count(self, industry: Industry | None = None) -> int:
        result = self._query(industry).count().get()
        return int(result[0][0].value)

    def search(
        self, query_vector: list[float], k: int = 5, industry: Industry | None = None
    ) -> list[SearchHit]:
        if k <= 0:
            return []
        vector_query = self._query(industry).find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vector),
            distance_measure=DistanceMeasure.COSINE,
            limit=k,
            distance_result_field=_DISTANCE_FIELD,
        )
        hits = []
        for snapshot in vector_query.get():
            data = snapshot.to_dict()
            score = cosine_similarity(float(data[_DISTANCE_FIELD]))
            hits.append(SearchHit(record=from_document(data), score=score))
        return hits

    def clear(self) -> None:
        while True:
            docs = list(self.collection.limit(_BATCH).stream())
            if not docs:
                return
            batch = self.client.batch()
            for doc in docs:
                batch.delete(doc.reference)
            batch.commit()
