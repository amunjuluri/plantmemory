"""Text embeddings via the Gemini embedding model."""

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from google import genai
from google.genai import types

from app.config import Settings, get_settings
from app.llm import get_genai_client
from app.models import IncidentCore

# gemini-embedding-001 accepts a batch of texts per request.
_BATCH_SIZE = 50
# gemini-embedding-2 on Vertex AI embeds one content per request (a list of strings
# is treated as one multi-part content), so those calls are made in parallel.
_PARALLEL_REQUESTS = 8


def incident_text(incident: IncidentCore) -> str:
    """Flatten the meaningful fields of an incident into one string for embedding."""
    parts = [
        f"Equipment: {incident.area_or_equipment}",
        f"Description: {incident.description}",
    ]
    if incident.suspected_cause:
        parts.append(f"Suspected cause: {incident.suspected_cause}")
    if incident.root_cause:
        parts.append(f"Root cause: {incident.root_cause}")
    if incident.action_taken:
        parts.append(f"Action taken: {incident.action_taken}")
    return "\n".join(parts)


def _uses_task_prefixes(model: str) -> bool:
    # gemini-embedding-2 has no task_type parameter; intent goes in the text.
    return model.startswith("gemini-embedding-2")


def _normalize(vectors: list[list[float]]) -> list[list[float]]:
    arr = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (arr / norms).tolist()


class GeminiEmbedder:
    """Embeds documents and queries with the configured Gemini embedding model."""

    def __init__(self, settings: Settings | None = None, client: genai.Client | None = None):
        self.settings = settings or get_settings()
        self._client = client

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            self._client = get_genai_client()
        return self._client

    def _embed(self, texts: Sequence[str], task_type: str) -> list[list[float]]:
        model = self.settings.embedding_model
        config = types.EmbedContentConfig(output_dimensionality=self.settings.embedding_dim)

        # Resolve the client once here: creating it lazily inside worker threads
        # can build duplicate clients whose cleanup closes the shared connection.
        client = self.client

        if _uses_task_prefixes(model):

            def embed_one(text: str) -> list[float]:
                result = client.models.embed_content(model=model, contents=text, config=config)
                return result.embeddings[0].values

            with ThreadPoolExecutor(max_workers=_PARALLEL_REQUESTS) as pool:
                vectors = list(pool.map(embed_one, texts))
        else:
            config.task_type = task_type
            vectors = []
            for start in range(0, len(texts), _BATCH_SIZE):
                batch = list(texts[start : start + _BATCH_SIZE])
                result = client.models.embed_content(model=model, contents=batch, config=config)
                vectors.extend(e.values for e in result.embeddings)

        if len(vectors) != len(texts):
            raise RuntimeError(f"Expected {len(texts)} embeddings, got {len(vectors)}")
        return _normalize(vectors)

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed texts that will be stored and searched over."""
        if _uses_task_prefixes(self.settings.embedding_model):
            texts = [f"title: none | text: {t}" for t in texts]
        return self._embed(texts, "RETRIEVAL_DOCUMENT")

    def embed_query(self, text: str) -> list[float]:
        """Embed a search query (a new incident description)."""
        if _uses_task_prefixes(self.settings.embedding_model):
            text = f"task: search result | query: {text}"
        return self._embed([text], "RETRIEVAL_QUERY")[0]
