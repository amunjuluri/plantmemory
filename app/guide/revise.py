"""Change a draft guide by asking: the manager says or types what to change.

Gemini hears the request (audio in any language, or text) and returns the whole guide
with the change made. Code then checks it exactly like a manual edit and works out what
the change means for QA. Nothing is saved here: the manager sees the proposal, then keeps
it (a normal edit, recorded in the audit trail) or discards it. Stateless: the client
sends back the proposal and the earlier requests to build on them.
"""

import json

from google.genai import types

from app.agent import prompts
from app.agent.tools import AgentDeps
from app.guide import builder, guardrails, workflow
from app.intake.voice import InvalidAudioError, sniff_audio_type
from app.kb import KnowledgeBase
from app.kb.loader import list_assets
from app.models import (
    Guide,
    GuideEdit,
    GuideItem,
    GuideRevision,
    GuideRevisionOut,
    GuideStep,
)

MAX_HISTORY = 6
FOLLOW_UP = """
YOU ASKED THE MANAGER A QUESTION (nothing was changed yet):
The manager asked: {asked}
You asked back: {question}
Their new message answers your question. Read it together with what they asked first,
and make that one change.
"""
# The limits a manual edit accepts (GuideEdit).
MAX_STEPS = 40
MAX_PARTS = 30
NOTHING_CHANGED = "Nothing changed. Say which step or line to change, and what it should say."


def _guide_for_prompt(guide: Guide) -> str:
    """The guide's editable content, numbered the way the manager sees it."""

    def item(n: int, i) -> dict:
        return {"n": n, "text": i.text, "citations": i.citations}

    return json.dumps(
        {
            "title": guide.title,
            "summary": guide.summary,
            "safety": [item(n, i) for n, i in enumerate(guide.safety, 1)],
            "steps": [
                item(n, s) | {"caution": s.caution, "figure_id": s.figure_id}
                for n, s in enumerate(guide.steps, 1)
            ],
            "parts": [{"part_no": p.part_no, "qty": p.qty, "why": p.why} for p in guide.parts],
            "restart_checks": [item(n, i) for n, i in enumerate(guide.restart_checks, 1)],
            "escalate_if": guide.escalate_if,
            "open_questions": guide.open_questions,
        },
        indent=1,
        ensure_ascii=False,
    )


def warnings(before: Guide, after: Guide) -> list[str]:
    """What the change means for the checks, in plain words."""
    out = []
    kept = {i.text.strip().casefold() for i in after.safety}
    for item in before.safety:
        if item.text.strip().casefold() not in kept:
            out.append(
                f"Safety point removed: “{item.text}”. Check the workers are still protected."
            )
    for reason in after.qa_reasons:
        if reason not in before.qa_reasons:
            out.append(f"QA must now check it: {reason}")
    if before.translations:
        out.append("The translations are made again when you approve it or send it to QA.")
    return out


def revise(
    guide_id: str,
    deps: AgentDeps,
    kb: KnowledgeBase,
    *,
    by: str,
    audio: bytes | None = None,
    text: str | None = None,
    base: GuideEdit | None = None,
    history: list[str] | None = None,
    asked: str | None = None,
    question: str | None = None,
) -> GuideRevision:
    """Propose the change the manager asked for, checked like an edit. Nothing is saved.

    `base` is a proposal the manager has not kept yet; the change is made on top of it.
    `asked` and `question` are an earlier request and the question it got back: the new
    message answers it ("in step 9"), so the two are read as one request.
    """
    if not audio and not (text and text.strip()):
        raise InvalidAudioError("Say or type what to change first.")
    guide = workflow.load(guide_id, kb)
    workflow._require(guide, "draft", "rejected", doing="changed")
    current = workflow.preview(guide, base, kb) if base else guide

    asset = next((a for a in list_assets(kb) if a.tag == guide.asset_tag), None)
    parts = builder.find_parts(asset, guide.manual_sections, kb)
    figures = []
    for fid in dict.fromkeys(f for s in guide.manual_sections for f in s.figure_ids):
        meta = kb.figures.get(fid)
        figures.append(f"{fid}: {meta.caption if meta else 'figure'}")
    sources = guardrails.source_texts(guide.similar_incidents, guide.manual_sections)
    earlier = [h.strip() for h in (history or []) if h.strip()][-MAX_HISTORY:]

    prompt = prompts.REVISE_PROMPT.format(
        plant=deps.settings.plant_type,
        guide=_guide_for_prompt(current),
        history="\n".join(f"- {h}" for h in earlier) or "(none)",
        follow_up=FOLLOW_UP.format(asked=asked.strip(), question=question.strip())
        if asked and asked.strip() and question and question.strip()
        else "",
        sections=builder._sections_for_prompt(guide.manual_sections),
        incidents=builder._history_for_prompt(guide.similar_incidents),
        figures="\n".join(figures) or "None.",
        parts="\n".join(f"{p.part_no}: {p.name}, {p.stock_qty} in store" for p in parts)
        or "None listed.",
        allowed=", ".join(sources) or "none",
    )
    contents: list = [prompt]
    if audio:
        contents.append(types.Part.from_bytes(data=audio, mime_type=sniff_audio_type(audio)))
    else:
        contents.append(f"Manager (typed): {text.strip()}")
    out = deps.llm.generate(contents, GuideRevisionOut, thinking="low", hedge_after_s=14.0)

    transcript = out.transcript.strip() or (text or "").strip()
    reply = (out.reply or "").strip() or None
    if not out.understood:
        return GuideRevision(
            transcript=transcript, language=out.language, reply=reply or NOTHING_CHANGED
        )

    c = out.content
    steps = [
        GuideStep(text=s.text, citations=s.citations, caution=s.caution, figure_id=s.figure_id)
        for s in c.steps
        if s.text.strip()
    ][:MAX_STEPS]
    edit = GuideEdit(
        by=by,
        title=(guardrails.strip_ids(c.title) or current.title)[:200],
        summary=guardrails.strip_ids(c.summary)[:4000],
        safety=[GuideItem(text=i.text, citations=i.citations) for i in c.safety],
        steps=steps or current.steps,
        parts=c.parts[:MAX_PARTS],
        restart_checks=[GuideItem(text=i.text, citations=i.citations) for i in c.restart_checks],
        escalate_if=[guardrails.strip_ids(t) for t in c.escalate_if],
        open_questions=[guardrails.strip_ids(t) for t in c.open_questions],
    )
    proposal = workflow.preview(guide, edit, kb)
    if _guide_for_prompt(proposal) == _guide_for_prompt(current):
        return GuideRevision(transcript=transcript, language=out.language, reply=NOTHING_CHANGED)
    return GuideRevision(
        transcript=transcript,
        language=out.language,
        changes=[c.strip() for c in out.changes if c.strip()],
        warnings=warnings(guide, proposal),
        proposal=proposal,
    )
