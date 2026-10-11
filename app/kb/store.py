"""A small document store for the knowledge base: manuals, error codes, parts, figures
and repair guides. One local JSON file or one Firestore collection per kind.

These collections are small (tens to hundreds of documents), so listing filters in
memory on the local store. Manual sections are searched with Firestore's native vector
search on Cloud Run, like incidents.
"""

import json
import logging
import threading
from abc import ABC, abstractmethod
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import BaseModel

log = logging.getLogger(__name__)

_BATCH = 400  # Firestore allows 500 writes per batch.
_DISTANCE_FIELD = "vector_distance"


class DocStore[T: BaseModel](ABC):
    """Documents of one Pydantic model, keyed by one of its fields."""

    def __init__(self, model: type[T], key: str = "id"):
        self.model = model
        self.key = key

    def _id(self, doc: T) -> str:
        return str(getattr(doc, self.key))

    @abstractmethod
    def put(self, docs: Iterable[T]) -> None:
        """Insert documents, replacing any with the same key."""

    @abstractmethod
    def get(self, doc_id: str) -> T | None:
        """One document by key, or None."""

    @abstractmethod
    def all(self, **equals: Any) -> list[T]:
        """Every document whose fields equal the given values (lists: contains the value)."""

    @abstractmethod
    def delete(self, doc_ids: Iterable[str]) -> None:
        """Delete documents by key. Missing keys are ignored."""

    @abstractmethod
    def search(self, vector: list[float], k: int = 5) -> list[tuple[T, float]]:
        """The k documents whose `embedding` is closest to `vector`, best first."""

    def clear(self) -> None:
        """Delete every document. Used by seeding and tests."""
        self.delete([self._id(d) for d in self.all()])


def _matches(doc: BaseModel, equals: dict[str, Any]) -> bool:
    for field, value in equals.items():
        actual = getattr(doc, field)
        if isinstance(actual, list):
            if value not in actual:
                return False
        elif actual != value:
            return False
    return True


def rank_by_cosine[T: BaseModel](
    docs: list[T], vector: list[float], k: int
) -> list[tuple[T, float]]:
    """The k documents whose `embedding` is closest to `vector`, computed in memory."""
    docs = [d for d in docs if getattr(d, "embedding", None)]
    if not docs or k <= 0:
        return []
    matrix = np.asarray([d.embedding for d in docs], dtype=np.float32)
    query = np.asarray(vector, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1) * (np.linalg.norm(query) or 1.0)
    norms[norms == 0] = 1.0
    scores = matrix @ query / norms
    return [(docs[i], float(scores[i])) for i in np.argsort(-scores)[:k]]


class LocalDocStore[T: BaseModel](DocStore[T]):
    """All documents in one JSON file, searched with numpy."""

    def __init__(self, model: type[T], path: Path, key: str = "id"):
        super().__init__(model, key)
        self.path = path
        self._lock = threading.Lock()
        self._docs: dict[str, T] = {}
        if path.exists():
            for raw in json.loads(path.read_text()):
                doc = model.model_validate(raw)
                self._docs[self._id(doc)] = doc

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps([d.model_dump(mode="json") for d in self._docs.values()]))
        tmp.replace(self.path)

    def put(self, docs: Iterable[T]) -> None:
        with self._lock:
            for doc in docs:
                self._docs[self._id(doc)] = doc
            self._save()

    def get(self, doc_id: str) -> T | None:
        return self._docs.get(doc_id)

    def all(self, **equals: Any) -> list[T]:
        return [d for d in self._docs.values() if _matches(d, equals)]

    def delete(self, doc_ids: Iterable[str]) -> None:
        with self._lock:
            for doc_id in doc_ids:
                self._docs.pop(doc_id, None)
            self._save()

    def search(self, vector: list[float], k: int = 5) -> list[tuple[T, float]]:
        return rank_by_cosine(list(self._docs.values()), vector, k)


class FirestoreDocStore[T: BaseModel](DocStore[T]):
    """One Firestore collection, one document per key."""

    def __init__(self, model: type[T], client, collection: str, key: str = "id"):
        super().__init__(model, key)
        self.client = client
        self.collection = client.collection(collection)

    def _to_document(self, doc: T) -> dict:
        from google.cloud.firestore_v1.vector import Vector

        data = doc.model_dump(mode="json", exclude={"embedding"})
        if getattr(doc, "embedding", None):
            data["embedding"] = Vector(doc.embedding)
        return data

    def _from_document(self, data: dict) -> T:
        data = dict(data)
        data.pop(_DISTANCE_FIELD, None)
        vector = data.get("embedding")
        if vector is not None and not isinstance(vector, list):
            data["embedding"] = list(vector)
        return self.model.model_validate(data)

    def put(self, docs: Iterable[T]) -> None:
        docs = list(docs)
        for start in range(0, len(docs), _BATCH):
            batch = self.client.batch()
            for doc in docs[start : start + _BATCH]:
                batch.set(self.collection.document(self._id(doc)), self._to_document(doc))
            batch.commit()

    def get(self, doc_id: str) -> T | None:
        snapshot = self.collection.document(doc_id).get()
        return self._from_document(snapshot.to_dict()) if snapshot.exists else None

    def all(self, **equals: Any) -> list[T]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        query = self.collection
        for field, value in equals.items():
            list_field = self.model.model_fields[field].annotation in (list[str], list[int])
            op = "array_contains" if list_field else "=="
            query = query.where(filter=FieldFilter(field, op, value))
        return [self._from_document(s.to_dict()) for s in query.stream()]

    def delete(self, doc_ids: Iterable[str]) -> None:
        doc_ids = list(doc_ids)
        for start in range(0, len(doc_ids), _BATCH):
            batch = self.client.batch()
            for doc_id in doc_ids[start : start + _BATCH]:
                batch.delete(self.collection.document(doc_id))
            batch.commit()

    def search(self, vector: list[float], k: int = 5) -> list[tuple[T, float]]:
        from google.api_core.exceptions import FailedPrecondition

        if k <= 0:
            return []
        try:
            return self._nearest(vector, k)
        except FailedPrecondition:
            # The vector index is still being built (minutes after a first deploy). These
            # collections are small, so rank them in memory rather than fail the request.
            log.warning("Vector index for %s not ready; ranking in memory", self.collection.id)
            return rank_by_cosine(self.all(), vector, k)

    def _nearest(self, vector: list[float], k: int) -> list[tuple[T, float]]:
        from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
        from google.cloud.firestore_v1.vector import Vector

        query = self.collection.find_nearest(
            vector_field="embedding",
            query_vector=Vector(vector),
            distance_measure=DistanceMeasure.COSINE,
            limit=k,
            distance_result_field=_DISTANCE_FIELD,
        )
        hits = []
        for snapshot in query.get():
            data = snapshot.to_dict()
            # COSINE distance is 1 - cosine similarity.
            hits.append((self._from_document(data), 1.0 - float(data[_DISTANCE_FIELD])))
        return hits
