"""Storage interface for incident records."""

from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass

from app.models import IncidentRecord, Industry


@dataclass(frozen=True)
class SearchHit:
    """A stored record and its cosine similarity to the query (higher is closer)."""

    record: IncidentRecord
    score: float


class IncidentStore(ABC):
    """Where incident records and their embeddings live."""

    @abstractmethod
    def upsert(self, records: Iterable[IncidentRecord]) -> None:
        """Insert records, replacing any with the same id. Records must have embeddings."""

    @abstractmethod
    def get(self, record_id: str) -> IncidentRecord | None:
        """Return one record by id, or None."""

    @abstractmethod
    def list_records(
        self, offset: int = 0, limit: int = 20, industry: Industry | None = None
    ) -> list[IncidentRecord]:
        """Return records, newest incident date first."""

    @abstractmethod
    def count(self, industry: Industry | None = None) -> int:
        """Return how many records are stored."""

    @abstractmethod
    def search(
        self, query_vector: list[float], k: int = 5, industry: Industry | None = None
    ) -> list[SearchHit]:
        """Return the k most similar records, best first."""

    @abstractmethod
    def clear(self) -> None:
        """Delete every record. Used by seeding and tests."""
