"""JSON-file store with in-memory cosine search. For local dev and tests."""

import json
import threading
from collections.abc import Iterable
from pathlib import Path

import numpy as np

from app.models import IncidentRecord, Industry
from app.store.base import IncidentStore, SearchHit


class LocalStore(IncidentStore):
    """Keeps all records in one JSON file; searches with numpy cosine similarity."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._records: dict[str, IncidentRecord] = {}
        if path.exists():
            raw = json.loads(path.read_text())
            self._records = {r["id"]: IncidentRecord.model_validate(r) for r in raw}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        data = [r.model_dump(mode="json") for r in self._records.values()]
        tmp.write_text(json.dumps(data, indent=1))
        tmp.replace(self.path)

    def _filtered(self, industry: Industry | None) -> list[IncidentRecord]:
        records = self._records.values()
        return [r for r in records if industry is None or r.industry == industry]

    def upsert(self, records: Iterable[IncidentRecord]) -> None:
        with self._lock:
            for record in records:
                if not record.embedding:
                    raise ValueError(f"Record {record.id} has no embedding")
                self._records[record.id] = record
            self._save()

    def get(self, record_id: str) -> IncidentRecord | None:
        return self._records.get(record_id)

    def list_records(
        self, offset: int = 0, limit: int = 20, industry: Industry | None = None
    ) -> list[IncidentRecord]:
        records = sorted(self._filtered(industry), key=lambda r: (r.date, r.id), reverse=True)
        return records[offset : offset + limit]

    def count(self, industry: Industry | None = None) -> int:
        return len(self._filtered(industry))

    def search(
        self, query_vector: list[float], k: int = 5, industry: Industry | None = None
    ) -> list[SearchHit]:
        records = self._filtered(industry)
        if not records or k <= 0:
            return []
        matrix = np.asarray([r.embedding for r in records], dtype=np.float32)
        query = np.asarray(query_vector, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1) * (np.linalg.norm(query) or 1.0)
        norms[norms == 0] = 1.0
        scores = matrix @ query / norms
        top = np.argsort(-scores)[:k]
        return [SearchHit(record=records[i], score=float(scores[i])) for i in top]

    def clear(self) -> None:
        with self._lock:
            self._records = {}
            self._save()
