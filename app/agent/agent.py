"""The ADK root agent and a helper to run it once per incident.

Tools pass their results to each other through session state rather than through
model-written arguments, so the model cannot alter a match list or a score between
steps. Each tool refuses to run before the step it depends on.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Literal

from google.adk import Agent, Runner
from google.adk.models import BaseLlm
from google.adk.runners import InMemoryRunner
from google.adk.tools import ToolContext
from google.genai import types
from pydantic import Field

from app.agent import tools
from app.agent.guardrails import CitationError
from app.agent.prompts import ROOT_INSTRUCTION
from app.config import get_settings
from app.models import (
    Draft,
    Industry,
    Model,
    Recurrence,
    SimilarIncident,
    StructuredIncident,
)

APP_NAME = "plantmemory"

# Session state keys.
USER_TEXT = "user_text"
INDUSTRY = "industry"
INCIDENT = "incident"
MATCHES = "matches"
RECURRENCE = "recurrence"
DRAFT = "draft"


class AgentError(RuntimeError):
    """The agent finished without producing a valid draft."""


def _later_steps_cleared(state, *keys: str) -> None:
    # Re-running a step invalidates everything computed after it.
    for key in keys:
        state[key] = None


async def structure_incident(text: str, tool_context: ToolContext) -> dict:
    """Step 1. Turn the user's free-text incident description into structured fields.

    Args:
        text: The user's incident description, copied word for word.
    """
    state = tool_context.state
    original = state.get(USER_TEXT) or text
    incident = await asyncio.to_thread(
        tools.structure_incident, original, tools.get_deps(), state.get(INDUSTRY)
    )
    state[INCIDENT] = incident.model_dump(mode="json")
    _later_steps_cleared(state, MATCHES, RECURRENCE, DRAFT)
    return {"status": "ok", "incident": state[INCIDENT]}


async def search_similar(tool_context: ToolContext, k: int = 5) -> dict:
    """Step 2. Find the k most similar past incidents to the structured incident.

    Args:
        k: How many past incidents to return (1 to 10).
    """
    state = tool_context.state
    if not state.get(INCIDENT):
        return {"status": "error", "error": "Call structure_incident first."}
    incident = StructuredIncident.model_validate(state[INCIDENT])
    matches = await asyncio.to_thread(
        tools.search_similar, incident, tools.get_deps(), max(1, min(k, 10)), state.get(INDUSTRY)
    )
    state[MATCHES] = [m.model_dump(mode="json") for m in matches]
    _later_steps_cleared(state, RECURRENCE, DRAFT)
    same_problem = {m.id for m in tools.relevant(matches, tools.get_deps().settings)}
    return {
        "status": "ok",
        "matches": [
            {"id": m.id, "score": m.score, "same_problem": m.id in same_problem} for m in matches
        ],
    }


async def check_recurrence(tool_context: ToolContext) -> dict:
    """Step 3. Count similar past incidents in the recent window and failed past fixes."""
    state = tool_context.state
    if state.get(MATCHES) is None:
        return {"status": "error", "error": "Call search_similar first."}
    incident = StructuredIncident.model_validate(state[INCIDENT])
    matches = [SimilarIncident.model_validate(m) for m in state[MATCHES]]
    recurrence = tools.check_recurrence(incident, matches, tools.get_deps())
    state[RECURRENCE] = recurrence.model_dump(mode="json")
    _later_steps_cleared(state, DRAFT)
    return {"status": "ok", **state[RECURRENCE]}


async def draft_report(tool_context: ToolContext) -> dict:
    """Step 4. Write the cited troubleshooting draft for human review."""
    state = tool_context.state
    if state.get(RECURRENCE) is None:
        return {"status": "error", "error": "Call check_recurrence first."}
    incident = StructuredIncident.model_validate(state[INCIDENT])
    matches = [SimilarIncident.model_validate(m) for m in state[MATCHES]]
    recurrence = Recurrence.model_validate(state[RECURRENCE])
    try:
        draft = await asyncio.to_thread(
            tools.draft_report, incident, matches, recurrence, tools.get_deps()
        )
    except CitationError as err:
        return {"status": "error", "error": str(err)}
    state[DRAFT] = draft.model_dump(mode="json")
    # The draft is the answer; skip the model's closing summary turn to save latency.
    tool_context.actions.skip_summarization = True
    return {"status": "ok", "summary": draft.summary, "citations": draft.citations}


def build_agent(model: str | BaseLlm | None = None) -> Agent:
    """Create the root agent. `model` defaults to GEMINI_MODEL; tests pass a fake."""
    return Agent(
        name=APP_NAME,
        model=model or get_settings().gemini_model,
        description="Finds similar past plant incidents and drafts a cited note for review.",
        instruction=ROOT_INSTRUCTION,
        tools=[structure_incident, search_similar, check_recurrence, draft_report],
        generate_content_config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="LOW"),
        ),
    )


root_agent = build_agent()


@lru_cache
def get_runner() -> Runner:
    """Return the process-wide runner (in-memory sessions; one session per request)."""
    return InMemoryRunner(agent=root_agent, app_name=APP_NAME)


class Progress(Model):
    """One update while the agent works: a step starting or finishing, then the result."""

    type: Literal["step", "draft", "error"]
    step: str | None = None
    status: Literal["started", "done", "error"] | None = None
    detail: str | None = None
    summary: str | None = Field(default=None, description="One plain line on what a step found.")
    draft: Draft | None = None


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def step_summary(step: str, result: dict) -> str | None:
    """A short, plain-language line describing a finished tool step, for the UI."""
    if step == "structure_incident":
        area = (result.get("incident") or {}).get("area_or_equipment")
        return f"Understood: {area}" if area and area != "unspecified" else "Understood the report"
    if step == "search_similar":
        same = sum(1 for m in result.get("matches", []) if m.get("same_problem"))
        return f"{_plural(same, 'similar incident')} found" if same else "No close match in memory"
    if step == "check_recurrence":
        months = result.get("window_months")
        parts = [
            f"Repeat: {_plural(len(result['in_window']), 'time')} in {months} months"
            if result.get("is_repeat")
            else f"Not a repeat in the last {months} months"
        ]
        if result.get("recurred"):
            parts.append(f"{_plural(len(result['recurred']), 'past fix')} did not hold")
        return ". ".join(parts)
    if step == "draft_report":
        cited = len(result.get("citations", []))
        return f"Draft ready, citing {_plural(cited, 'record')}" if cited else "Draft ready"
    return None


async def analyze_events(
    text: str, industry: Industry | None = None, runner: Runner | None = None
) -> AsyncIterator[Progress]:
    """Run the agent on one incident, yielding step progress and finally the draft."""
    runner = runner or get_runner()
    sessions = runner.session_service
    user_id = "api"
    session = await sessions.create_session(
        app_name=runner.app_name,
        user_id=user_id,
        session_id=uuid.uuid4().hex,
        state={USER_TEXT: text, INDUSTRY: industry},
    )
    try:
        message = types.Content(role="user", parts=[types.Part(text=text)])
        async for event in runner.run_async(
            user_id=user_id, session_id=session.id, new_message=message
        ):
            for call in event.get_function_calls():
                yield Progress(type="step", step=call.name, status="started")
            for response in event.get_function_responses():
                result = response.response or {}
                failed = result.get("status") == "error"
                yield Progress(
                    type="step",
                    step=response.name,
                    status="error" if failed else "done",
                    detail=result.get("error"),
                    summary=None if failed else step_summary(response.name, result),
                )
        final = await sessions.get_session(
            app_name=runner.app_name, user_id=user_id, session_id=session.id
        )
    finally:
        await sessions.delete_session(
            app_name=runner.app_name, user_id=user_id, session_id=session.id
        )

    raw = final.state.get(DRAFT) if final else None
    if raw:
        yield Progress(type="draft", draft=Draft.model_validate(raw))
    else:
        yield Progress(type="error", detail="The agent finished without producing a draft.")


async def analyze(
    text: str, industry: Industry | None = None, runner: Runner | None = None
) -> Draft:
    """Run the agent on one incident description and return its validated draft."""
    async for update in analyze_events(text, industry, runner):
        if update.type == "draft":
            return update.draft
        if update.type == "error":
            raise AgentError(update.detail)
    raise AgentError("The agent stopped unexpectedly.")
