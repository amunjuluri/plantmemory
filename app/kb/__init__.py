"""The plant's knowledge base beyond incidents: manuals, alarm codes, parts, figures, guides
and the plant's settings."""

import re
from dataclasses import dataclass
from functools import lru_cache

from app.config import Settings, get_settings
from app.kb.store import DocStore, FirestoreDocStore, LocalDocStore
from app.models import ErrorCode, Figure, Guide, ManualSection, Part, PlantSettings

__all__ = ["KnowledgeBase", "code_key", "get_kb", "set_kb"]


def code_key(code: str) -> str:
    """Normalise an alarm code for lookup: "E-104", "e 104" and "E104" all give "E104"."""
    return re.sub(r"[^A-Z0-9]", "", code.upper())


@dataclass
class KnowledgeBase:
    """One store per kind of document."""

    sections: DocStore[ManualSection]
    codes: DocStore[ErrorCode]
    parts: DocStore[Part]
    figures: DocStore[Figure]
    guides: DocStore[Guide]
    settings: DocStore[PlantSettings]


def build_kb(settings: Settings) -> KnowledgeBase:
    """Create the stores for STORE_BACKEND."""
    kinds = {
        "sections": (ManualSection, "manual_sections", "id"),
        "codes": (ErrorCode, "error_codes", "id"),
        "parts": (Part, "parts", "part_no"),
        "figures": (Figure, "figures", "id"),
        "guides": (Guide, "guides", "id"),
        "settings": (PlantSettings, "plant_settings", "id"),
    }
    prefix = settings.kb_collection_prefix
    if settings.store_backend == "firestore":
        from google.cloud import firestore

        client = firestore.Client(
            project=settings.google_cloud_project, database=settings.firestore_database
        )
        stores = {
            name: FirestoreDocStore(model, client, prefix + collection, key)
            for name, (model, collection, key) in kinds.items()
        }
    else:
        stores = {
            name: LocalDocStore(model, settings.local_kb_dir / f"{prefix}{collection}.json", key)
            for name, (model, collection, key) in kinds.items()
        }
    return KnowledgeBase(**stores)


_kb: KnowledgeBase | None = None


@lru_cache
def _default_kb() -> KnowledgeBase:
    return build_kb(get_settings())


def get_kb() -> KnowledgeBase:
    """The process-wide knowledge base (tests replace it with set_kb)."""
    return _kb or _default_kb()


def set_kb(kb: KnowledgeBase | None) -> None:
    """Override the knowledge base (tests), or reset it with None."""
    global _kb
    _kb = kb
