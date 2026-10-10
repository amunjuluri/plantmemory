"""Offline stand-ins for Gemini, the embedder and the ADK model."""

from collections.abc import AsyncGenerator
from datetime import date
from pathlib import Path

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import types

from app.agent.tools import AgentDeps
from app.config import Settings
from app.models import DraftContent, IncidentRecord, StructuredIncident
from app.store.local_store import LocalStore

INCIDENT_DATE = date(2026, 10, 1)
MATCHING = [1.0, 0.0, 0.0]
UNRELATED = [0.0, 1.0, 0.0]


class FakeLLM:
    """Returns a fixed StructuredIncident and queued DraftContents; records prompts."""

    def __init__(self, drafts: list[DraftContent] | None = None, **incident_fields):
        fields = {
            "date": INCIDENT_DATE,
            "area_or_equipment": "PM2 press section",
            "description": "placeholder",
        }
        self.incident = StructuredIncident(**(fields | incident_fields))
        self.drafts = list(drafts or [])
        self.prompts: list[tuple[str, str]] = []

    def generate(self, contents, schema, thinking="low"):
        self.prompts.append((schema.__name__, contents))
        if schema is StructuredIncident:
            return self.incident
        if schema is DraftContent:
            return self.drafts.pop(0)
        raise AssertionError(f"unexpected schema {schema}")


class FakeEmbedder:
    """Every query embeds to `query_vector`; documents embed to MATCHING."""

    def __init__(self, query_vector: list[float]):
        self.query_vector = query_vector
        self.documents: list[str] = []

    def embed_query(self, text: str) -> list[float]:
        return self.query_vector

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.documents.extend(texts)
        return [MATCHING for _ in texts]


def seeded_store(path: Path) -> LocalStore:
    """Three records: two close to MATCHING (one shallow-cause recurrence), one far away."""
    store = LocalStore(path)
    common = {"industry": "paper", "area_or_equipment": "PM2 press"}
    store.upsert(
        [
            IncidentRecord(
                id="PAP-0001",
                date=date(2026, 6, 18),
                description="Web breaks after the second press.",
                root_cause="HP shower nozzles plugged.",
                action_taken="Cleaned nozzles.",
                outcome="resolved",
                embedding=MATCHING,
                **common,
            ),
            IncidentRecord(
                id="PAP-0005",
                date=date(2025, 3, 2),
                description="Breaks at the press, felt glazed.",
                root_cause="Operator error.",
                action_taken="Operator retrained.",
                outcome="recurred",
                embedding=[0.95, 0.3, 0.0],
                **common,
            ),
            IncidentRecord(
                id="PHA-0003",
                industry="pharma",
                date=date(2026, 1, 5),
                area_or_equipment="Isolator 2",
                description="Glove breach.",
                outcome="resolved",
                embedding=[0.0, 0.0, 1.0],
            ),
        ]
    )
    return store


def make_deps(
    tmp_path: Path, query_vector: list[float], llm: FakeLLM, threshold: float = 0.70
) -> AgentDeps:
    settings = Settings(match_threshold=threshold, recurrence_window_months=12, _env_file=None)
    return AgentDeps(
        settings=settings,
        store=seeded_store(tmp_path / "incidents.json"),
        embedder=FakeEmbedder(query_vector),
        llm=llm,
    )


AGENT_STEPS = [
    ("structure_incident", {"text": "Web keeps breaking after the press."}),
    ("search_similar", {"k": 5}),
    ("check_recurrence", {}),
    ("draft_report", {}),
]


class ScriptedAdkModel(BaseLlm):
    """An ADK model that calls the given tools in order, then replies with text.

    It picks the next step by counting tool responses already in the conversation.
    """

    model: str = "scripted"
    steps: list[tuple[str, dict]] = AGENT_STEPS

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse]:
        done = sum(1 for c in llm_request.contents for p in (c.parts or []) if p.function_response)
        if done < len(self.steps):
            name, args = self.steps[done]
            part = types.Part(function_call=types.FunctionCall(name=name, args=args))
        else:
            part = types.Part(text="The draft is ready for human review.")
        yield LlmResponse(content=types.Content(role="model", parts=[part]))
