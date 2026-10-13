"""Voice intake: a short spoken back-and-forth that fills a breakdown report or a closure.

The manager speaks in any language. Gemini hears the audio, fills fields in English and
asks for what is missing in the manager's language. Code decides which fields are
required and when the report is complete; the model never decides that it is done.
Stateless: the client sends the conversation back each turn.
"""

import re

from google.genai import types

from app.agent import prompts
from app.agent.guardrails import format_minutes
from app.agent.tools import AgentDeps
from app.guide.translate import language_name
from app.models import (
    Asset,
    IntakeFields,
    IntakeMessage,
    IntakeState,
    IntakeTurnOut,
    IntakeTurnResult,
)

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_TURNS = 5

REQUIRED = {
    "breakdown": ["equipment", "symptom", "machine_stopped"],
    "closure": ["action_taken", "downtime_minutes", "outcome"],
}
FIELD_LABEL = {
    "equipment": "which machine",
    "symptom": "what is wrong",
    "machine_stopped": "whether the machine has stopped",
    "action_taken": "what was done",
    "downtime_minutes": "how long the machine was down",
    "outcome": "whether it is fixed",
    "parts_used": "which parts were replaced (or none)",
}
FALLBACK_QUESTION = {
    "equipment": "Which machine is it? Please say its tag, for example TP-02.",
    "symptom": "What is wrong with the machine? Is there an alarm code on the screen?",
    "machine_stopped": "Has the machine stopped, or is it still running?",
    "action_taken": "What was done to fix it?",
    "downtime_minutes": "How long was the machine down, in total?",
    "outcome": "Is it fixed now, or might it come back?",
}
OUTCOME_TEXT = {"resolved": "Fixed.", "recurred": "Came back.", "unknown": "Not sure yet."}


class InvalidAudioError(ValueError):
    """The upload is not a supported audio recording, or is too large."""


def sniff_audio_type(data: bytes) -> str:
    """Audio MIME type from the file's first bytes, or raise InvalidAudioError."""
    if len(data) > MAX_AUDIO_BYTES:
        raise InvalidAudioError("That recording is too long. Keep it under a minute.")
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if data.startswith(b"OggS"):
        return "audio/ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data.startswith(b"fLaC"):
        return "audio/flac"
    if data.startswith(b"ID3") or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if data[:2] in (b"\xff\xf1", b"\xff\xf9"):
        return "audio/aac"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    raise InvalidAudioError("Send a voice recording (WebM, Ogg, MP4/M4A, WAV, MP3 or FLAC).")


# "Stopped" or "not working" says nothing about the fault, so it does not count as one.
_VAGUE_SYMPTOM = re.compile(
    r"^(the )?(machine|press|line|it)?\s*(has )?(stopped|stopping|not working|broken( down)?|"
    r"breakdown|down|tripped|problem|issue|fault)\.?$",
    re.IGNORECASE,
)


def missing_fields(state: IntakeState) -> list[str]:
    missing = [f for f in REQUIRED[state.mode] if getattr(state.fields, f) in (None, "")]
    symptom = state.fields.symptom
    if state.mode == "breakdown" and symptom and _VAGUE_SYMPTOM.match(symptom.strip()):
        missing.insert(min(1, len(missing)), "symptom")
    return missing


def merge(old: IntakeFields, new: IntakeFields) -> IntakeFields:
    """Keep what was said before; take every value said now."""
    update = {k: v for k, v in new.model_dump().items() if v not in (None, "")}
    return old.model_copy(update=update)


def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith((".", "!", "?")) else f"{text}."


def summary(state: IntakeState) -> str:
    """The report in English, ready to start a guide or close one."""
    f = state.fields
    if state.mode == "closure":
        parts = [f"Done: {_sentence(f.action_taken)}" if f.action_taken else ""]
        if f.root_cause:
            parts.append(f"Cause: {_sentence(f.root_cause)}")
        if f.parts_used:
            parts.append(f"Parts used: {_sentence(f.parts_used)}")
        if f.downtime_minutes is not None:
            parts.append(f"Downtime {format_minutes(f.downtime_minutes)}.")
        if f.outcome:
            parts.append(OUTCOME_TEXT[f.outcome])
        return " ".join(p for p in parts if p)

    head = f"{f.equipment}: " if f.equipment else ""
    parts = [f"{head}{f.symptom or 'problem not described yet'}."]
    if f.error_code:
        parts.append(f"Alarm {f.error_code} on the screen.")
    if f.machine_stopped is not None:
        parts.append("Machine stopped." if f.machine_stopped else "Machine still running.")
    if f.started:
        parts.append(f"Started {f.started}.")
    if f.product_or_batch:
        parts.append(f"Product or batch: {f.product_or_batch}.")
    if f.already_tried:
        parts.append(f"Already tried: {f.already_tried}.")
    words = [m.text for m in state.history if m.role == "manager"]
    if state.language and state.language != "en" and words:
        parts.append(f'Manager\'s words ({language_name(state.language)}): "{" ".join(words)}"')
    return " ".join(parts)


def _history_text(history: list[IntakeMessage]) -> str:
    if not history:
        return "(none yet)"
    return "\n".join(f"{m.role}: {m.text}" for m in history[-10:])


def take_turn(
    state: IntakeState,
    deps: AgentDeps,
    assets: list[Asset],
    audio: bytes | None = None,
    text: str | None = None,
) -> IntakeTurnResult:
    """Hear one message (audio or typed), update the report, and ask for what is missing."""
    if not audio and not (text and text.strip()):
        raise InvalidAudioError("Say or type something first.")
    missing = missing_fields(state)
    prompt = prompts.INTAKE_PROMPT.format(
        plant=deps.settings.plant_type,
        purpose=prompts.INTAKE_BREAKDOWN if state.mode == "breakdown" else prompts.INTAKE_CLOSURE,
        fields=state.fields.model_dump_json(exclude_none=True) or "{}",
        history=_history_text(state.history),
        missing=", ".join(FIELD_LABEL[m] for m in missing) or "nothing",
        assets=", ".join(f"{a.tag} ({a.equipment_model})" for a in assets) or "unknown",
        field_rules=prompts.INTAKE_FIELD_RULES[state.mode],
    )
    contents: list = [prompt]
    if audio:
        mime = sniff_audio_type(audio)
        contents.append(types.Part.from_bytes(data=audio, mime_type=mime))
    else:
        contents.append(f"Manager (typed): {text.strip()}")
    heard = deps.llm.generate(contents, IntakeTurnOut, thinking="low", hedge_after_s=10.0)

    fields = merge(state.fields, heard.fields)
    if state.mode == "closure" and fields.downtime_minutes is not None:
        fields.downtime_minutes = max(0, fields.downtime_minutes)
    transcript = heard.transcript.strip() or (text or "").strip()
    history = [*state.history, IntakeMessage(role="manager", text=transcript)]
    new_state = IntakeState(
        mode=state.mode,
        fields=fields,
        history=history,
        language=heard.language or state.language,
        turns=state.turns + 1,
    )
    still_missing = missing_fields(new_state)
    done = not still_missing or new_state.turns >= MAX_TURNS
    question = None
    if not done:
        question = (heard.question or "").strip() or FALLBACK_QUESTION[still_missing[0]]
        new_state.history.append(IntakeMessage(role="assistant", text=question))
    return IntakeTurnResult(
        state=new_state,
        transcript=transcript,
        question=question,
        missing=still_missing,
        done=done,
        summary=summary(new_state),
    )
