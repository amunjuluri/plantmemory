"""The repair-guide pipeline as an ADK graph Workflow.

    START ─┬─ structure ─┬─ decide ──draft──┬─ history ─┬─ parts ── write
           └─ check ─────┘    └──ask: stop   └─ manual ──┘

ADK runs the graph: the order is fixed (a model choosing it adds turns and risk, see
DECISIONS 43), both reads of the report and both searches run side by side, `decide`
either asks the manager one question or routes on to drafting, and each node has a
timeout; the searches retry once on a transient Firestore error. The nodes call the same
plain functions as before (app/guide/builder.py), which are tested without ADK, and the
code checks on the written guide are unchanged. Progress for the UI goes on a queue as
each node starts and finishes.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from google.adk.events.event import Event
from google.adk.runners import InMemoryRunner
from google.adk.workflow import START, FunctionNode, JoinNode, RetryConfig, Workflow
from google.api_core.exceptions import DeadlineExceeded, ServiceUnavailable
from google.genai import types

from app import telemetry
from app.agent import tools
from app.agent.guardrails import format_minutes, ordinal
from app.agent.tools import AgentDeps
from app.guide.builder import (
    Evidence,
    _plural,
    check_report,
    clarify,
    find_asset,
    find_codes,
    find_parts,
    find_sections,
    write_guide,
)
from app.kb import KnowledgeBase
from app.kb.loader import list_assets
from app.llm import BUSY_MESSAGE, is_overloaded
from app.models import Asset, Guide, GuideProgress, GuideRequest, ReportCheck, StructuredIncident

log = logging.getLogger(__name__)

APP_NAME = "plantmemory-guide"
# Generous: they stop a stuck call, not a slow one (a guide has taken 35 s; the model
# layer sends a second copy of a slow request long before these).
READ_TIMEOUT_S = 60.0
SEARCH_TIMEOUT_S = 90.0
WRITE_TIMEOUT_S = 150.0
TRANSIENT = RetryConfig(
    max_attempts=2, initial_delay=0.5, exceptions=[ServiceUnavailable, DeadlineExceeded]
)


@dataclass
class Run:
    """One drafting run: its inputs, what each node found, and the progress queue."""

    request: GuideRequest
    deps: AgentDeps
    kb: KnowledgeBase
    assets: list[Asset]
    picked: Asset | None
    progress: asyncio.Queue
    incident: StructuredIncident | None = None
    check: ReportCheck | None = None
    ev: Evidence | None = None
    question: GuideProgress | None = None
    guide: Guide | None = None
    began: float = field(default_factory=time.perf_counter)

    def started(self, step: str) -> None:
        self.progress.put_nowait(GuideProgress(type="step", step=step, status="started"))

    def done(self, step: str, summary: str) -> None:
        self.progress.put_nowait(
            GuideProgress(type="step", step=step, status="done", summary=summary)
        )


def build_workflow(run: Run) -> Workflow:
    """The graph for one run. Nodes close over `run`, so large results (manual sections,
    past fixes) stay in memory instead of being serialised between nodes."""

    async def structure(node_input) -> dict:
        run.incident = await asyncio.to_thread(tools.structure_incident, run.request.text, run.deps)
        return {"equipment": run.incident.area_or_equipment}

    async def check(node_input) -> dict:
        run.check = await asyncio.to_thread(
            check_report, run.request, run.picked, run.assets, run.deps
        )
        return {"checked": run.check is not None}

    async def decide(node_input):
        request, incident = run.request, run.incident
        named = find_asset([request.text], run.assets)
        codes = find_codes(request.text)
        question = clarify(request, run.check, named, run.picked, codes, run.assets)
        if question:
            run.question = question
            run.done("understand", "One question before drafting")
            telemetry.event(
                "guide_clarify",
                picked=run.picked.tag if run.picked else None,
                named=named.tag if named else None,
                machines=len(question.machines),
            )
            yield Event(output={"ask": question.question}, route="ask")
            return
        asset = find_asset(
            [request.text, incident.area_or_equipment], run.assets, requested=request.asset_tag
        )
        run.ev = Evidence(incident=incident, codes=codes, asset=asset)
        what = asset.tag if asset else incident.area_or_equipment
        run.done("understand", f"{what}{', alarm ' + ', '.join(codes) if codes else ''}")
        run.started("search_history")
        run.started("search_manuals")
        yield Event(output={"machine": asset.tag if asset else None}, route="draft")

    async def history(node_input) -> dict:
        ev, deps = run.ev, run.deps

        def search():
            found = tools.search_similar(ev.incident, deps, k=5)
            same = tools.verify_matches(ev.incident, found, deps)
            return same, tools.check_recurrence(ev.incident, same, deps)

        ev.matches, ev.recurrence = await asyncio.to_thread(search)
        if not ev.matches:
            run.done("search_history", "No past fix for this problem in memory")
        else:
            line = f"{_plural(len(ev.matches), 'past fix')} found"
            rec = ev.recurrence
            if rec and rec.is_repeat:
                line += f", {ordinal(rec.occurrence)} time in {rec.window_months} months"
            if rec and rec.recurred:
                line += f"; {_plural(len(rec.recurred), 'fix')} did not hold"
            run.done("search_history", line)
        return {"past_fixes": len(ev.matches)}

    async def manual(node_input) -> dict:
        ev = run.ev
        ev.sections, ev.error_codes = await asyncio.to_thread(
            find_sections, ev.incident, ev.codes, ev.asset, run.deps, run.kb
        )
        if ev.sections:
            model = ev.sections[0].equipment_model
            run.done(
                "search_manuals", f"{_plural(len(ev.sections), 'section')} from the {model} manual"
            )
        else:
            run.done("search_manuals", "No manual section matched")
        return {"sections": len(ev.sections)}

    async def parts(node_input) -> dict:
        ev, kb = run.ev, run.kb
        run.started("find_parts")
        if ev.asset is None and ev.sections:
            # Only when one machine uses this manual; otherwise parts go by equipment model
            # rather than naming a machine the manager never mentioned.
            same = [a for a in run.assets if a.manual_id == ev.sections[0].manual_id]
            ev.asset = same[0] if len(same) == 1 else None
        ev.parts = await asyncio.to_thread(find_parts, ev.asset, ev.sections, kb)
        figure_ids = list(dict.fromkeys(f for s in ev.sections for f in s.figure_ids))
        for fid in figure_ids:
            meta = await asyncio.to_thread(kb.figures.get, fid)
            if meta:
                ev.figure_captions[fid] = meta.caption
        run.done(
            "find_parts",
            f"{_plural(len(ev.parts), 'part')} listed for this machine"
            if ev.parts
            else "No spare parts listed for this machine",
        )
        return {"parts": len(ev.parts)}

    async def write(node_input) -> dict:
        run.started("write_guide")
        guide = await asyncio.to_thread(write_guide, run.request, run.ev, run.deps)
        await asyncio.to_thread(run.kb.guides.put, [guide])
        line = _plural(len(guide.steps), "step")
        if guide.downtime.manual_minutes:
            line += f", about {format_minutes(guide.downtime.manual_minutes)}"
        run.done("write_guide", line)
        run.guide = guide
        return {"guide": guide.id}

    reads = (
        FunctionNode(func=structure, timeout=READ_TIMEOUT_S),
        FunctionNode(func=check, timeout=READ_TIMEOUT_S),
    )
    searches = (
        FunctionNode(func=history, timeout=SEARCH_TIMEOUT_S, retry_config=TRANSIENT),
        FunctionNode(func=manual, timeout=SEARCH_TIMEOUT_S, retry_config=TRANSIENT),
    )
    decision = FunctionNode(func=decide)
    return Workflow(
        name="draft_repair_guide",
        edges=[
            (START, reads, JoinNode(name="report_read"), decision),
            # Route "ask" has no edge: the run ends with the question.
            (decision, {"draft": searches}),
            (
                searches,
                JoinNode(name="evidence"),
                FunctionNode(func=parts, timeout=SEARCH_TIMEOUT_S),
                FunctionNode(func=write, timeout=WRITE_TIMEOUT_S),
            ),
        ],
    )


async def build_guide_events(
    request: GuideRequest, deps: AgentDeps, kb: KnowledgeBase
) -> AsyncIterator[GuideProgress]:
    """Draft a guide, yielding progress for each step and finally the saved guide, or one
    question for the manager."""
    progress: asyncio.Queue = asyncio.Queue()
    task: asyncio.Task | None = None
    try:
        yield GuideProgress(type="step", step="understand", status="started")
        assets = await asyncio.to_thread(list_assets, kb)
        picked = find_asset([], assets, requested=request.asset_tag) if request.asset_tag else None
        run = Run(
            request=request, deps=deps, kb=kb, assets=assets, picked=picked, progress=progress
        )
        runner = InMemoryRunner(node=build_workflow(run), app_name=APP_NAME)
        session = await runner.session_service.create_session(app_name=APP_NAME, user_id="manager")
        message = types.Content(role="user", parts=[types.Part(text=request.text)])

        async def drive() -> None:
            try:
                async for _ in runner.run_async(
                    user_id="manager", session_id=session.id, new_message=message
                ):
                    pass
            finally:
                progress.put_nowait(None)

        task = asyncio.create_task(drive())
        while (update := await progress.get()) is not None:
            yield update
        await task  # raises what a node raised

        if run.question:
            yield run.question
            return
        guide = run.guide
        if guide is None:
            raise RuntimeError("The workflow finished without a guide or a question.")
        telemetry.event(
            "guide_drafted",
            guide=guide.id,
            asset=guide.asset_tag,
            seconds=round(time.perf_counter() - run.began, 1),
            steps=len(guide.steps),
            repeat=bool(guide.recurrence and guide.recurrence.is_repeat),
            qa_needed=bool(guide.qa_reasons),
        )
        yield GuideProgress(type="guide", guide=guide)
    except Exception as err:
        if is_overloaded(err):
            telemetry.event("guide_draft_busy")
            yield GuideProgress(type="error", detail=BUSY_MESSAGE)
        else:
            log.exception("Guide drafting failed")
            yield GuideProgress(type="error", detail="Something went wrong. Please try again.")
    finally:
        if task and not task.done():
            task.cancel()
