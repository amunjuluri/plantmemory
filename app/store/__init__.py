"""Incident storage backends."""

from functools import lru_cache

from app.config import get_settings
from app.store.base import IncidentStore, SearchHit

__all__ = ["IncidentStore", "SearchHit", "get_store"]


@lru_cache
def get_store() -> IncidentStore:
    """Return the store selected by STORE_BACKEND."""
    s = get_settings()
    if s.store_backend == "firestore":
        from app.store.firestore_store import FirestoreStore

        return FirestoreStore(
            database=s.firestore_database,
            collection=s.firestore_collection,
            project=s.google_cloud_project,
        )
    from app.store.local_store import LocalStore

    return LocalStore(s.local_store_path)
