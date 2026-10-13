"""Embed the seed incidents (real public repair records) and load them into the store.

Usage: uv run python -m scripts.seed [--reset]
"""

import argparse
import json

from app.config import ROOT_DIR, get_settings
from app.embeddings import GeminiEmbedder, incident_text
from app.models import IncidentRecord
from app.store import get_store

SEED_PATH = ROOT_DIR / "data" / "seed" / "incidents_seed.json"


def load_seed_records() -> list[IncidentRecord]:
    """Read the seed file into records (without embeddings)."""
    return [IncidentRecord.model_validate(r) for r in json.loads(SEED_PATH.read_text())]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete all records first")
    args = parser.parse_args()

    settings = get_settings()
    store = get_store()
    records = load_seed_records()
    vectors = GeminiEmbedder(settings).embed_documents([incident_text(r) for r in records])
    for record, vector in zip(records, vectors, strict=True):
        record.embedding = vector

    if args.reset:
        store.clear()
    store.upsert(records)
    print(
        f"Seeded {len(records)} records into '{settings.store_backend}' store "
        f"with {settings.embedding_model} ({len(vectors[0])} dims). Total: {store.count()}."
    )


if __name__ == "__main__":
    main()
