"""Offline stand-ins for Gemini, the embedder and the ADK model."""

import re
from collections.abc import AsyncGenerator
from datetime import date
from pathlib import Path

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import errors as genai_errors
from google.genai import types

from app.agent.tools import AgentDeps
from app.config import Settings
from app.models import (
    DraftContent,
    IncidentRecord,
    LogbookExtraction,
    MatchCheck,
    MatchVerdict,
    StructuredIncident,
)
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
        self.extraction = LogbookExtraction()
        self.not_same: set[str] = set()  # candidate ids the fake match check rejects
        # Replies for any other schema: an object, a list (one per call) or a callable.
        self.responses: dict[type, object] = {}

    def generate(self, contents, schema, thinking="low", timeout_ms=None, hedge_after_s=None):
        self.prompts.append((schema.__name__, contents))
        if schema in self.responses:
            reply = self.responses[schema]
            if isinstance(reply, list):
                reply = reply.pop(0)
            return reply(contents) if callable(reply) else reply
        if schema is StructuredIncident:
            return self.incident
        if schema is DraftContent:
            return self.drafts.pop(0)
        if schema is LogbookExtraction:
            return self.extraction
        if schema is MatchCheck:
            ids = re.findall(r'"id": "([^"]+)"', contents if isinstance(contents, str) else "")
            return MatchCheck(
                verdicts=[
                    MatchVerdict(id=i, same_problem=i not in self.not_same, why=f"Same as {i}.")
                    for i in ids
                ]
            )
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


class OverloadedAdkModel(BaseLlm):
    """An ADK model whose every call fails the way Vertex AI does when out of capacity."""

    model: str = "overloaded"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse]:
        raise overloaded_error()
        yield  # pragma: no cover - makes this an async generator


def overloaded_error(code: int = 429) -> genai_errors.ClientError | genai_errors.ServerError:
    body = {
        "error": {"code": code, "message": "Resource exhausted.", "status": "RESOURCE_EXHAUSTED"}
    }
    cls = genai_errors.ClientError if code < 500 else genai_errors.ServerError
    return cls(code, body)


# --- Knowledge base: a small manual, alarm codes, parts and a figure ---

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def make_kb(tmp_path: Path):
    """A local knowledge base with one tablet press manual for TP-02."""
    import base64

    from app.kb import KnowledgeBase
    from app.kb.loader import build_manual
    from app.kb.store import LocalDocStore
    from app.models import ErrorCode, Figure, Guide, ManualSection, Part, PlantSettings

    kb = KnowledgeBase(
        sections=LocalDocStore(ManualSection, tmp_path / "manual_sections.json"),
        codes=LocalDocStore(ErrorCode, tmp_path / "error_codes.json"),
        parts=LocalDocStore(Part, tmp_path / "parts.json", key="part_no"),
        figures=LocalDocStore(Figure, tmp_path / "figures.json"),
        guides=LocalDocStore(Guide, tmp_path / "guides.json"),
        settings=LocalDocStore(PlantSettings, tmp_path / "plant_settings.json"),
    )
    sections, codes = build_manual(
        "RTP37",
        "RTP-37 manual",
        "Kestrel RTP-37 rotary tablet press",
        ["TP-01", "TP-02"],
        [
            {
                "page": 3,
                "title": "1.2 Lockout",
                "kind": "safety",
                "text": "Switch isolator Q1 OFF and lock it. Release valve V3 to 0 bar.",
            },
            {
                "page": 14,
                "title": "6.1 Alarm list",
                "kind": "error_codes",
                "text": "E-104 Upper punch tight. W-212 Compression force deviation.",
                "error_codes": ["E-104", "W-212"],
            },
            {
                "page": 16,
                "title": "6.2 E-104 Upper punch tight",
                "kind": "troubleshooting",
                "text": "Remove the punch with tool T-12. Clean the bore with 70% IPA. Typical "
                "time: 45 minutes.",
                "error_codes": ["E-104"],
                "repair_minutes": 45,
                "figure_ids": ["FIG-1"],
            },
            {
                "page": 21,
                "title": "6.5 W-212 Compression force deviation",
                "kind": "troubleshooting",
                "text": "Rising W-212 often comes before E-104.",
                "error_codes": ["W-212"],
                "repair_minutes": 20,
            },
            {
                "page": 28,
                "title": "9.6 Return to service after a repair",
                "kind": "procedure",
                "text": "Run the turret empty at 10 rpm for 2 minutes.",
            },
        ],
        [
            {
                "code": "E-104",
                "title": "Upper punch tight",
                "severity": "error",
                "stops_machine": True,
                "first_actions": ["Lock out the press"],
                "repair_minutes": 45,
                "page": 16,
            },
            {
                "code": "W-212",
                "title": "Compression force deviation",
                "severity": "warning",
                "stops_machine": False,
                "repair_minutes": 20,
                "page": 21,
            },
        ],
    )
    for section in sections:
        section.embedding = MATCHING
    kb.sections.put(sections)
    kb.codes.put(codes)
    common = {
        "equipment_model": "Kestrel RTP-37 rotary tablet press",
        "asset_tags": ["TP-01", "TP-02"],
    }
    kb.parts.put(
        [
            Part(part_no="RTP-PN-U-10", name="Upper punch", stock_qty=6, **common),
            Part(
                part_no="RTP-BS-07", name="Guide bushing", stock_qty=1, lead_time_days=21, **common
            ),
            Part(part_no="RTP-BT-04", name="V-belt", stock_qty=0, lead_time_days=10, **common),
        ]
    )
    kb.figures.put(
        [
            Figure(
                id="FIG-1",
                caption="Removing a punch",
                data_b64=base64.b64encode(PNG_BYTES).decode(),
            )
        ]
    )
    return kb
