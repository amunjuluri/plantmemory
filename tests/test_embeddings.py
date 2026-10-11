import json
from types import SimpleNamespace

import numpy as np
import pytest

from app.config import ROOT_DIR, Settings
from app.embeddings import GeminiEmbedder, incident_text
from app.models import IncidentRecord


class FakeModels:
    """Records embed_content calls and returns one fixed vector per content."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def embed_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        items = contents if isinstance(contents, list) else [contents]
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[3.0, 4.0]) for _ in items])


def make_embedder(model: str) -> tuple[GeminiEmbedder, FakeModels]:
    fake = FakeModels()
    settings = Settings(embedding_model=model, embedding_dim=2, _env_file=None)
    return GeminiEmbedder(settings, client=SimpleNamespace(models=fake)), fake


def test_embedding_2_uses_prompt_prefixes_one_call_per_text() -> None:
    embedder, fake = make_embedder("gemini-embedding-2")
    vectors = embedder.embed_documents(["felt plugged", "slime in chest"])
    assert len(vectors) == 2
    assert len(fake.calls) == 2
    assert all(c["contents"].startswith("title: none | text: ") for c in fake.calls)
    assert fake.calls[0]["config"].task_type is None

    embedder.embed_query("sheet break")
    assert fake.calls[-1]["contents"] == "task: search result | query: sheet break"


def test_embedding_001_batches_and_sets_task_type() -> None:
    embedder, fake = make_embedder("gemini-embedding-001")
    embedder.embed_documents(["a", "b", "c"])
    assert len(fake.calls) == 1
    assert fake.calls[0]["contents"] == ["a", "b", "c"]
    assert fake.calls[0]["config"].task_type == "RETRIEVAL_DOCUMENT"


def test_vectors_are_unit_length() -> None:
    embedder, _ = make_embedder("gemini-embedding-2")
    vector = embedder.embed_query("x")
    assert np.linalg.norm(vector) == pytest.approx(1.0)
    assert vector == pytest.approx([0.6, 0.8])


def test_incident_text_includes_causes_and_actions() -> None:
    raw = json.loads((ROOT_DIR / "data" / "seed" / "incidents_seed.json").read_text())
    record = IncidentRecord.model_validate(raw[0])
    text = incident_text(record)
    for value in (record.description, record.root_cause, record.action_taken):
        assert value in text


def test_seed_data_is_valid_and_has_unique_ids() -> None:
    raw = json.loads((ROOT_DIR / "data" / "seed" / "incidents_seed.json").read_text())
    records = [IncidentRecord.model_validate(r) for r in raw]
    assert len({r.id for r in records}) == len(records) == 52
    assert sum(r.industry == "paper" for r in records) == 22
    assert sum(r.industry == "pharma" for r in records) == 30

    cases = json.loads((ROOT_DIR / "data" / "eval" / "retrieval_cases.json").read_text())
    ids = {r.id for r in records}
    for case in cases["cases"]:
        assert set(case["expected"]) <= ids
    for case in cases["negatives"]:
        assert case.get("looks_like") in ids | {None}
    assert sum(c["low_keyword"] for c in cases["cases"]) >= 3
