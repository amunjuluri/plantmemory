"""Live voice intake on Gemini Live: the manager talks, Gemini talks back in their language.

The browser streams 16 kHz PCM from the microphone over a WebSocket; this module relays it
to a Gemini Live session and relays the spoken replies (24 kHz PCM) and both transcripts
back. Gemini fills the report by calling `update_report`; code merges the fields, decides
what is still missing (the same rules as the turn-based intake in `voice.py`) and tells
Gemini what to ask next. The report is finished only when code finds nothing missing and
the manager has confirmed it, by voice or with the button.

Messages to the browser are JSON text frames, except the reply audio (binary frames):
  ready, transcript {role, text}, turn_complete, interrupted, report {result},
  confirmed {result}, error {message}
Messages from the browser: binary PCM audio, or JSON {type: text|confirm|end}.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from pydantic import ValidationError

from app.agent.guardrails import format_minutes
from app.config import Settings, get_settings
from app.guide.builder import find_asset
from app.intake.voice import FIELD_LABEL, missing_fields, summary
from app.models import (
    Asset,
    Guide,
    IntakeFields,
    IntakeMessage,
    IntakeMode,
    IntakeState,
    IntakeTurnResult,
)

log = logging.getLogger(__name__)

INPUT_MIME = "audio/pcm;rate=16000"
MAX_SESSION_S = 8 * 60
MAX_AUDIO_FRAME = 64 * 1024

PURPOSE = {
    "breakdown": "The manager is reporting a machine breakdown, so a repair guide can be drafted.",
    "closure": (
        "The repair is done. The manager is telling you what was actually done, so the plant "
        "remembers it next time this breakdown happens."
    ),
}

SYSTEM = """\
You are the voice assistant of PlantMemory, used by maintenance managers in a
{plant} in India. {purpose}

Speak like a helpful colleague on the shop floor: short, natural, spoken sentences, one or
two at a time. Always reply in the language the manager last used (Telugu, Hindi, English
or a mix, as they speak). Never use lists, markdown or long explanations.

How to work:
- Each time the manager tells you something new, call update_report with every detail said
  so far. Write the values in English. Copy machine tags, alarm codes, part numbers and
  numbers exactly. Never guess a value that was not said or that cannot be worked out from
  the context below.
- update_report answers with what is still missing. Ask for it, at most two things at once.
- When update_report says the report is complete, read it back in one or two short
  sentences and ask the manager to check it on the screen and say yes, or say what to change.
- When they say yes, call confirm_report, then say one short closing sentence.
- If you did not understand, ask again. Never make more than two tool calls without speaking.

{context}"""

BREAKDOWN_CONTEXT = """\
Machines in this plant (tag, then model): {assets}.
`equipment` is always the plant's tag, written as listed (for example TP-01), never the
model name. People say tags loosely ("TP one", "టీపీ 1", "टीपी वन" all mean TP-01). If they
name a kind of machine the plant has several of ("the tablet press"), ask which one.
That the machine stopped is not the problem itself: ask what is wrong or what alarm shows."""

CLOSURE_CONTEXT = """\
The breakdown and its approved repair guide:
- Machine: {asset}. Breakdown reported as: {request}
- Guide {guide_id}: {title}
- Steps in the guide:
{steps}
- Parts the guide listed: {parts}
- Time: the guide was drafted {elapsed} ago, so the machine has been down at least that long.

Managers often answer briefly. Work out what they mean from the guide:
- "Did what the guide said", "guide lo cheppinattu chesam", "guide ke hisaab se kiya":
  fill `action_taken` as "Followed guide {guide_id}: " plus a one-line summary of the
  guide's steps. Then ask only what the guide cannot tell you.
- "Did steps 1 to 4", "only cleaned it": fill `action_taken` as "Followed steps 1 to 4 of
  guide {guide_id}: " (or say what was done) plus a summary of only those steps.
- Parts: if they followed the whole guide, the parts it listed were used, and code fills
  `parts_used` with them. Name them in the read-back ("the upper punch was replaced") so
  the manager can correct it. Otherwise ask which of the listed parts were actually
  replaced, naming them simply ("the upper punch?"). "None" is a valid answer: then
  `parts_used` is "None".
- Downtime: if they do not know, offer the time since the guide was drafted ("about
  {elapsed}?") and use it if they agree. Convert hours to minutes.
- Outcome: "running fine now" means resolved; "came back" means recurred; "not sure yet"
  means unknown.
- Cause: ask once; if they do not know, leave it empty. Do not ask again."""

# The model writes a closure that followed the whole guide this way (see CLOSURE_CONTEXT).
_WHOLE_GUIDE = re.compile(r"^followed guide\b", re.IGNORECASE)

# "Did it" or "as the guide said" says nothing yet: the model must expand it from the guide.
_VAGUE_ACTION = re.compile(
    r"^(i |we )?(did|done|fixed|completed|finished|ok|okay)( it| that)?( as)?( per)?"
    r"( the)?( guide)?( said| says)?\.?$|^as (per )?(the )?guide( said| says)?\.?$",
    re.IGNORECASE,
)


@dataclass
class LiveSession:
    """One voice conversation: the report so far and the context the model was given."""

    mode: IntakeMode
    assets: list[Asset]
    guide: Guide | None = None
    state: IntakeState = field(init=False)
    confirmed: bool = False
    _heard: list[str] = field(default_factory=list)
    _said: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.state = IntakeState(mode=self.mode)

    # --- what is missing, decided in code ---

    def missing(self) -> list[str]:
        missing = missing_fields(self.state)
        f = self.state.fields
        if self.mode == "closure":
            if f.action_taken and _VAGUE_ACTION.match(f.action_taken.strip()):
                missing.insert(0, "action_taken")
            # The guide listed parts, so memory should say which were really used ("None" is fine).
            if self.guide and self.guide.parts and not f.parts_used:
                missing.insert(1, "parts_used")
        return list(dict.fromkeys(missing))

    def result(self) -> IntakeTurnResult:
        missing = self.missing()
        return IntakeTurnResult(
            state=self.state,
            transcript=" ".join(self._heard).strip(),
            question=None,
            missing=missing,
            done=not missing,
            summary=summary(self.state),
        )

    # --- tools Gemini calls ---

    def update(self, args: dict) -> dict:
        language = args.pop("language", None)
        if language:
            self.state.language = str(language)[:5].lower()
        known = set(IntakeFields.model_fields)
        clean = {k: v for k, v in args.items() if k in known and v not in (None, "")}
        if self.mode == "closure" and "downtime_minutes" in clean:
            try:
                clean["downtime_minutes"] = max(0, round(float(clean["downtime_minutes"])))
            except (TypeError, ValueError):
                clean.pop("downtime_minutes")
        if clean.get("outcome") not in (None, "resolved", "recurred", "unknown"):
            clean.pop("outcome")
        if equipment := clean.get("equipment"):
            asset = find_asset([str(equipment)], self.assets, str(equipment))
            if asset:
                clean["equipment"] = asset.tag
        merged = {**self.state.fields.model_dump(), **clean}
        try:
            self.state.fields = IntakeFields.model_validate(merged)
        except ValidationError as err:  # drop a value of the wrong type, keep the rest
            for bad in {e["loc"][0] for e in err.errors() if e["loc"]}:
                merged[bad] = getattr(self.state.fields, str(bad))
            self.state.fields = IntakeFields.model_validate(merged)
        filled = self._parts_from_guide()
        missing = self.missing()
        if missing:
            labels = ", ".join(FIELD_LABEL[m] for m in missing)
            return {
                "status": "ok",
                "missing": labels,
                "guidance": f"Still needed: {labels}. Ask for it in the manager's language.",
            }
        then = (
            "if the fields on the screen are right, they can say yes and press Save to close "
            "the breakdown"
            if self.mode == "closure"
            else "if it is right, say yes and the repair guide will be drafted"
        )
        parts_note = (
            f" The parts were taken from the guide ({filled}): name them in the read-back."
            if filled
            else ""
        )
        return {
            "status": "ok",
            "missing": "nothing",
            "report": summary(self.state),
            "guidance": (
                "The report is complete. Read it back in one or two short sentences in the "
                f"manager's language. Tell them: {then}; or tell you what to change.{parts_note}"
            ),
        }

    def _parts_from_guide(self) -> str | None:
        """Followed the whole guide and named no parts: the guide's parts were the ones used.
        Filled in code, so "did what the guide said" never leaves the parts empty."""
        f = self.state.fields
        if (
            self.mode != "closure"
            or not self.guide
            or not self.guide.parts
            or f.parts_used
            or not f.action_taken
            or not _WHOLE_GUIDE.match(f.action_taken.strip())
        ):
            return None
        f.parts_used = guide_parts(self.guide)
        return f.parts_used

    def confirm(self) -> dict:
        missing = self.missing()
        if missing:
            labels = ", ".join(FIELD_LABEL[m] for m in missing)
            return {
                "status": "incomplete",
                "retryable": True,
                "message": f"Not complete yet: {labels}. Ask for it first.",
            }
        self.confirmed = True
        then = (
            "Tell them to press Save on the screen to close the breakdown. Do not say it is saved."
            if self.mode == "closure"
            else "Tell them the repair guide is being drafted now."
        )
        return {"status": "ok", "message": f"Confirmed. {then} One short sentence."}

    # --- transcripts ---

    def heard(self, text: str) -> None:
        self._heard.append(text)

    def said(self, text: str) -> None:
        self._said.append(text)

    def end_turn(self) -> None:
        """Move this turn's transcripts into the history kept with the report."""
        if heard := "".join(self._heard).strip():
            self.state.history.append(IntakeMessage(role="manager", text=heard[:4000]))
        if said := "".join(self._said).strip():
            self.state.history.append(IntakeMessage(role="assistant", text=said[:4000]))
        self.state.history = self.state.history[-40:]
        self._heard, self._said = [], []
        self.state.turns += 1


def _tools(mode: IntakeMode) -> list[types.Tool]:
    s = types.Schema
    text = "STRING"
    language = s(type=text, description="ISO 639-1 code of the language the manager speaks.")
    if mode == "breakdown":
        props = {
            "equipment": s(type=text, description="The plant's machine tag, e.g. TP-01."),
            "symptom": s(type=text, description="What is wrong, in English."),
            "machine_stopped": s(type="BOOLEAN", description="True if the machine stopped."),
            "error_code": s(type=text, description="Alarm code on the screen, e.g. E-104."),
            "started": s(type=text, description="When it started."),
            "product_or_batch": s(type=text, description="Product or batch running."),
            "already_tried": s(type=text, description="Anything already tried."),
        }
    else:
        props = {
            "action_taken": s(type=text, description="What was done to fix it, in English."),
            "root_cause": s(type=text, description="What caused it, in English, if known."),
            "parts_used": s(type=text, description='Part numbers or names replaced, or "None".'),
            "downtime_minutes": s(type="INTEGER", description="Total downtime in minutes."),
            "outcome": s(type=text, enum=["resolved", "recurred", "unknown"]),
        }
    update = types.FunctionDeclaration(
        name="update_report",
        description="Save every detail the manager has said so far. Returns what is missing.",
        parameters=s(type="OBJECT", properties={**props, "language": language}),
        behavior=types.Behavior.BLOCKING,
    )
    confirm = types.FunctionDeclaration(
        name="confirm_report",
        description="Call only after the manager has heard the read-back and said yes.",
        behavior=types.Behavior.BLOCKING,
    )
    return [types.Tool(function_declarations=[update, confirm])]


def _elapsed(since: datetime) -> str:
    return format_minutes(max(1, round((datetime.now(UTC) - since).total_seconds() / 60)))


def guide_parts(guide: Guide) -> str:
    """The guide's parts as one line: "RTP-PN-U-10 Upper punch x1; ..." """
    return "; ".join(f"{p.part_no} {p.name} x{p.qty}".replace("  ", " ") for p in guide.parts)


def instructions(live: LiveSession) -> str:
    if live.mode == "closure" and live.guide:
        g = live.guide
        steps = "\n".join(f"  {n}. {s.text}" for n, s in enumerate(g.steps, 1))
        parts = guide_parts(g) or "none"
        context = CLOSURE_CONTEXT.format(
            asset=g.asset_tag or g.incident.area_or_equipment,
            request=g.request[:600],
            guide_id=g.id,
            title=g.title,
            steps=steps,
            parts=parts,
            elapsed=_elapsed(g.created_at),
        )
    elif live.mode == "closure":
        context = "No guide was given; ask what was done, the cause, downtime and outcome."
    else:
        assets = ", ".join(f"{a.tag} ({a.equipment_model})" for a in live.assets) or "unknown"
        context = BREAKDOWN_CONTEXT.format(assets=assets)
    return SYSTEM.format(
        plant=get_settings().plant_type, purpose=PURPOSE[live.mode], context=context
    )


def vocabulary(live: LiveSession, codes: list[str]) -> list[str]:
    """Words the transcription should expect: machine tags, alarm codes, part numbers."""
    words = [a.tag for a in live.assets] + codes
    if live.guide:
        words += [p.part_no for p in live.guide.parts] + live.guide.error_codes
    return list(dict.fromkeys(words))[:100]


def connect_config(live: LiveSession, settings: Settings, codes: list[str]):
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=instructions(live),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.live_voice)
            )
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(
            custom_vocabulary=vocabulary(live, codes)
        ),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=_tools(live.mode),
    )


async def run(
    ws: WebSocket, live: LiveSession, client: genai.Client, settings: Settings, codes: list[str]
) -> None:
    """Relay one conversation between the browser and Gemini Live until it ends."""

    async def send(kind: str, **data) -> None:
        await ws.send_text(json.dumps({"type": kind, **data}, ensure_ascii=False, default=str))

    async def report(kind: str = "report") -> None:
        await send(kind, result=live.result().model_dump(mode="json"))

    config = connect_config(live, settings, codes)
    try:
        async with client.aio.live.connect(model=settings.live_model, config=config) as session:
            await send("ready")

            async def upstream() -> None:
                while True:
                    msg = await ws.receive()
                    if msg["type"] == "websocket.disconnect":
                        return
                    if data := msg.get("bytes"):
                        if len(data) <= MAX_AUDIO_FRAME:
                            await session.send_realtime_input(
                                audio=types.Blob(data=data, mime_type=INPUT_MIME)
                            )
                        continue
                    try:
                        body = json.loads(msg.get("text") or "{}")
                    except json.JSONDecodeError:
                        continue
                    if body.get("type") == "text" and (text := str(body.get("text", ""))[:4000]):
                        live.heard(text)
                        await session.send_realtime_input(text=text)
                    elif body.get("type") == "audio_end":
                        await session.send_realtime_input(audio_stream_end=True)
                    elif body.get("type") == "confirm":
                        if live.confirm()["status"] == "ok":
                            live.end_turn()
                            await report("confirmed")
                            return
                    elif body.get("type") == "end":
                        return

            async def downstream() -> None:
                while True:
                    async for msg in session.receive():
                        if msg.go_away:
                            await send("error", message="The voice session ended. Start again.")
                            return
                        if msg.tool_call:
                            responses = []
                            for call in msg.tool_call.function_calls or []:
                                args = dict(call.args or {})
                                result = (
                                    live.update(args)
                                    if call.name == "update_report"
                                    else live.confirm()
                                    if call.name == "confirm_report"
                                    else {"status": "error", "message": "Unknown tool."}
                                )
                                responses.append(
                                    types.FunctionResponse(
                                        id=call.id, name=call.name, response=result
                                    )
                                )
                            await session.send_tool_response(function_responses=responses)
                            await report()
                        content = msg.server_content
                        if not content:
                            continue
                        if content.input_transcription and content.input_transcription.text:
                            live.heard(content.input_transcription.text)
                            await send(
                                "transcript", role="manager", text=content.input_transcription.text
                            )
                        if content.output_transcription and content.output_transcription.text:
                            live.said(content.output_transcription.text)
                            await send(
                                "transcript",
                                role="assistant",
                                text=content.output_transcription.text,
                            )
                        if content.model_turn:
                            for part in content.model_turn.parts or []:
                                if part.inline_data and part.inline_data.data:
                                    await ws.send_bytes(part.inline_data.data)
                        if content.interrupted:
                            await send("interrupted")
                        if content.turn_complete:
                            live.end_turn()
                            await send("turn_complete")
                            if live.confirmed:
                                await report("confirmed")
                                return

            tasks = [asyncio.create_task(upstream()), asyncio.create_task(downstream())]
            done, pending = await asyncio.wait(
                tasks, timeout=MAX_SESSION_S, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                if (err := task.exception()) and not isinstance(err, WebSocketDisconnect):
                    raise err
            if not done:
                await send("error", message="Voice sessions last up to 8 minutes. Start again.")
    except WebSocketDisconnect:
        return
    except Exception:
        log.exception("Live voice session failed")
        try:
            await send("error", message="Voice isn't available right now. Type the report instead.")
        except Exception:  # the browser already left
            return
