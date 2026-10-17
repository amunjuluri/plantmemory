"""Draft a repair guide for a breakdown from plant memory, equipment manuals and the parts store.

The steps are plain functions run in a fixed order (no agent loop): the order never
changes, and a fixed pipeline lets the history and manual searches run side by side.
Each step's progress is streamed to the UI.
"""

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app import telemetry
from app.agent import prompts, tools
from app.agent.guardrails import _display_date, format_minutes, ordinal
from app.agent.tools import AgentDeps
from app.approval import new_record_id
from app.embeddings import incident_text
from app.guide import guardrails, workflow
from app.kb import KnowledgeBase, code_key
from app.kb.loader import list_assets
from app.llm import BUSY_MESSAGE, is_overloaded
from app.models import (
    Asset,
    ErrorCode,
    Guide,
    GuideContent,
    GuideEvent,
    GuideProgress,
    GuideRequest,
    ManualPick,
    ManualSection,
    ManualSectionPublic,
    Part,
    Recurrence,
    ReportCheck,
    SimilarIncident,
    SourceRef,
    StructuredIncident,
)

log = logging.getLogger(__name__)

# Alarm codes as they appear on HMIs and in logs: E-104, W 212, ALM-12, ERR17.
_CODE = re.compile(r"\b(E|W|A|F|AL|ALM|ERR)[- ]?(\d{1,4})\b", re.IGNORECASE)
_TAG = re.compile(r"\b([A-Za-z]{1,4})[- ]?(\d{1,3})\b")
MAX_SECTIONS = 8
MAX_PARTS = 40


def find_codes(text: str) -> list[str]:
    """Alarm codes in free text, as "E-104"."""
    return list(dict.fromkeys(f"{p.upper()}-{n}" for p, n in _CODE.findall(text)))


def _tag_key(letters: str, digits: str) -> str:
    return f"{letters.upper()}{int(digits)}"


def find_asset(texts: list[str], assets: list[Asset], requested: str | None = None) -> Asset | None:
    """The machine named in the report: "TP-02", "tp02" and "TP 2" all find TP-02."""
    by_key = {}
    for asset in assets:
        m = _TAG.fullmatch(asset.tag.replace(" ", "-"))
        by_key[_tag_key(*m.groups()) if m else code_key(asset.tag)] = asset
    if requested:
        m = _TAG.fullmatch(requested.strip())
        key = _tag_key(*m.groups()) if m else code_key(requested)
        if key in by_key:
            return by_key[key]
    for text in texts:
        for letters, digits in _TAG.findall(text or ""):
            asset = by_key.get(_tag_key(letters, digits))
            if asset:
                return asset
    return None


def check_report(
    request: GuideRequest, picked: Asset | None, assets: list[Asset], deps: AgentDeps
) -> ReportCheck | None:
    """Gemini's first read of the report (see ReportCheck). None if it fails: drafting then
    goes ahead as it would without the check, rather than stopping the manager."""
    machines = "\n".join(f"{a.tag}: {a.equipment_model}" for a in assets) or "None listed."
    prompt = prompts.REPORT_CHECK_PROMPT.format(
        plant=deps.settings.plant_type,
        text=request.text,
        picked=f"{picked.tag} ({picked.equipment_model})" if picked else "none",
        machines=machines,
    )
    try:
        return deps.llm.generate(prompt, ReportCheck, thinking="low", hedge_after_s=5.0)
    except Exception as err:
        log.warning("Report check failed, drafting without it: %s", err)
        return None


def clarify(
    request: GuideRequest,
    check: ReportCheck | None,
    named: Asset | None,
    picked: Asset | None,
    codes: list[str],
    assets: list[Asset],
) -> GuideProgress | None:
    """One question for the manager, or None to draft. Code decides, from what the report
    names and Gemini's read of it: a guide for the wrong machine is worse than a question,
    and a guide from "machine stopped" would be general advice, not a repair."""

    def ask(question: str, machines: list[Asset] | None = None) -> GuideProgress:
        return GuideProgress(type="clarify", question=question, machines=machines or [])

    machine = picked or named
    if check and not check.problem and not codes:
        if machine:
            return ask(
                f"What's wrong with {machine.tag}? Say what it's doing, or the alarm on its screen."
            )
        return ask(
            "Which machine stopped, and what's wrong with it? Say what it's doing, or the "
            "alarm on its screen."
        )
    if picked and not request.machine_confirmed:
        if named and named.tag != picked.tag:
            return ask(
                f"The report mentions {named.tag}, but {picked.tag} is picked. "
                "Which machine is it?",
                [named, picked],
            )
        if check and not check.fits_picked:
            other = next((a for a in assets if a.tag == check.machine_tag), None)
            if other and other.tag != picked.tag:
                return ask(
                    f"This sounds like {other.tag} ({other.equipment_model}), not {picked.tag} "
                    f"({picked.equipment_model}). Which machine is it?",
                    [other, picked],
                )
            return ask(
                f"This doesn't sound like {picked.tag} ({picked.equipment_model}). "
                f"{check.why} Pick the right machine, or draft for {picked.tag} anyway.",
                [picked],
            )
    if not machine and check and not check.equipment:
        return ask("Which machine is it?", assets)
    return None


def _public(section: ManualSection) -> ManualSectionPublic:
    return ManualSectionPublic.model_validate(section.model_dump(exclude={"embedding"}))


def find_sections(
    incident: StructuredIncident,
    codes: list[str],
    asset: Asset | None,
    deps: AgentDeps,
    kb: KnowledgeBase,
) -> tuple[list[ManualSectionPublic], list[ErrorCode]]:
    """Manual sections for this breakdown: the alarm's own section first, then the closest
    sections by meaning, then the manual's safety and return-to-service sections."""
    matched_codes: list[ErrorCode] = []
    for code in codes:
        for entry in kb.codes.all(code_key=code_key(code)):
            if asset is None or asset.tag in entry.asset_tags:
                matched_codes.append(entry)

    vector = deps.embedder.embed_query(incident_text(incident))
    hits = [
        (s, score)
        for s, score in kb.sections.search(vector, k=12)
        if score >= deps.settings.manual_threshold
    ]

    manual_id = asset.manual_id if asset else None
    if manual_id is None and matched_codes:
        manual_id = matched_codes[0].manual_id
    if manual_id is None and hits:
        manual_id = confirm_manual(incident, hits, deps)
    if manual_id is None:
        return [], matched_codes
    matched_codes = [c for c in matched_codes if c.manual_id == manual_id]

    chosen: dict[str, ManualSection] = {}
    for entry in matched_codes:
        if entry.section_id and (section := kb.sections.get(entry.section_id)):
            chosen[section.id] = section
    for section, _ in hits:
        if section.manual_id == manual_id and len(chosen) < MAX_SECTIONS - 2:
            chosen.setdefault(section.id, section)
    for section in sorted(kb.sections.all(manual_id=manual_id), key=lambda s: s.page):
        returning = section.kind == "procedure" and "return to service" in section.title.lower()
        if section.kind == "safety" or returning:
            chosen.setdefault(section.id, section)
    return [_public(s) for s in chosen.values()], matched_codes


def confirm_manual(
    incident: StructuredIncident, hits: list[tuple[ManualSection, float]], deps: AgentDeps
) -> str | None:
    """For a report naming no machine and no alarm: the manual Gemini confirms is for this
    equipment, or None.

    Scores alone cannot tell: a coating-pan report scores 0.70 against the tablet press
    manual, as high as some true matches. Gemini can only pick a manual the search found.
    """
    offered: dict[str, ManualSection] = {}
    for section, _ in hits:
        offered.setdefault(section.manual_id, section)
    manuals = [
        {"manual_id": m, "equipment": s.equipment_model, "title": s.manual_title}
        for m, s in offered.items()
    ]
    prompt = prompts.MANUAL_CHECK_PROMPT.format(
        incident=incident.model_dump_json(
            indent=1, include={"area_or_equipment", "description", "suspected_cause"}
        ),
        manuals=json.dumps(manuals, indent=1),
    )
    pick = deps.llm.generate(prompt, ManualPick, thinking="low", hedge_after_s=8.0)
    return pick.manual_id if pick.manual_id in offered else None


def find_parts(
    asset: Asset | None, sections: list[ManualSectionPublic], kb: KnowledgeBase
) -> list[Part]:
    """Spare parts for this machine (or for the manual's equipment model)."""
    if asset is not None:
        parts = kb.parts.all(asset_tags=asset.tag)
    elif sections:
        parts = kb.parts.all(equipment_model=sections[0].equipment_model)
    else:
        parts = []
    return sorted(parts, key=lambda p: p.part_no)[:MAX_PARTS]


def _history_for_prompt(matches: list[SimilarIncident]) -> str:
    if not matches:
        return "None. No past record describes the same problem."
    return json.dumps([tools._match_for_prompt(m) for m in matches], indent=1)


def _sections_for_prompt(sections: list[ManualSectionPublic]) -> str:
    if not sections:
        return "None."
    return "\n\n".join(
        f"[{s.id}] {s.manual_title}, page {s.page}: {s.title}\n{s.text}" for s in sections
    )


@dataclass
class Evidence:
    """Everything found for one breakdown before the guide is written."""

    incident: StructuredIncident
    codes: list[str]
    asset: Asset | None
    matches: list[SimilarIncident] = field(default_factory=list)
    recurrence: Recurrence | None = None
    sections: list[ManualSectionPublic] = field(default_factory=list)
    error_codes: list[ErrorCode] = field(default_factory=list)
    parts: list[Part] = field(default_factory=list)
    figure_captions: dict[str, str] = field(default_factory=dict)


def write_guide(request: GuideRequest, ev: Evidence, deps: AgentDeps) -> Guide:
    """Ask the model for the guide, then check every line against the evidence."""
    sources = guardrails.source_texts(ev.matches, ev.sections)
    figures = set(ev.figure_captions)
    prompt = prompts.GUIDE_PROMPT.format(
        plant=deps.settings.plant_type,
        incident=ev.incident.model_dump_json(
            indent=1, include={"date", "area_or_equipment", "description", "suspected_cause"}
        ),
        asset=f"{ev.asset.tag} ({ev.asset.equipment_model})" if ev.asset else "not identified",
        codes=", ".join(ev.codes) or "none",
        history=_history_for_prompt(ev.matches),
        recurrence=(ev.recurrence.note if ev.recurrence and ev.recurrence.note else "No repeats."),
        sections=_sections_for_prompt(ev.sections),
        figures="\n".join(f"{i}: {c}" for i, c in ev.figure_captions.items()) or "None.",
        parts="\n".join(f"{p.part_no}: {p.name}, {p.stock_qty} in store" for p in ev.parts)
        or "None listed.",
        allowed=", ".join(sources) or "none",
        no_source_rule="" if ev.sections else prompts.GUIDE_NO_MANUAL,
    )
    # Normally 8 to 16 s, but the same prompt has taken 35 s; a second copy is sent after 14 s.
    content = deps.llm.generate(
        prompt, GuideContent, thinking=deps.settings.draft_thinking_level, hedge_after_s=14.0
    )

    steps = guardrails.check_steps(content.steps, sources, figures)
    safety = [guardrails.check_item(i, sources) for i in content.safety if i.text.strip()]
    checks = [guardrails.check_item(i, sources) for i in content.restart_checks if i.text.strip()]
    parts, part_flags = guardrails.check_parts(content.parts, {p.part_no: p for p in ev.parts})
    cited = {c for item in [*steps, *safety, *checks] for c in item.citations}

    flags = guardrails.guide_flags(ev.sections, steps) + part_flags

    now = datetime.now(UTC)
    guide = Guide(
        id=new_record_id("GDE"),
        request=request.text,
        incident=ev.incident,
        asset_tag=ev.asset.tag if ev.asset else None,
        equipment_model=(
            ev.asset.equipment_model
            if ev.asset
            else (ev.sections[0].equipment_model if ev.sections else None)
        ),
        error_codes=ev.codes,
        title=guardrails.strip_ids(content.title),
        summary=guardrails.strip_ids(content.summary),
        safety=safety,
        steps=steps,
        parts=parts,
        restart_checks=checks,
        escalate_if=[guardrails.strip_ids(t) for t in content.escalate_if if t.strip()],
        open_questions=[guardrails.strip_ids(t) for t in content.open_questions if t.strip()],
        similar_incidents=ev.matches,
        recurrence=ev.recurrence if ev.matches else None,
        recurrence_note=ev.recurrence.note if ev.matches and ev.recurrence else None,
        manual_sections=ev.sections,
        sources=source_refs(ev.matches, ev.sections),
        downtime=guardrails.estimate_downtime(cited, ev.sections, ev.matches, ev.codes),
        flags=flags,
        events=[GuideEvent(at=now, by=request.by, action="created")],
        created_at=now,
        updated_at=now,
    )
    guide.qa_reasons = workflow.qa_reasons(guide, deps.settings.qa_approval)
    return guide


def source_refs(
    matches: list[SimilarIncident], sections: list[ManualSectionPublic]
) -> list[SourceRef]:
    refs = [
        SourceRef(
            id=m.id,
            kind="incident",
            label=f"{m.record.area_or_equipment}, {_display_date(m.record.date)}",
        )
        for m in matches
        if m.record
    ]
    refs += [
        SourceRef(
            id=s.id,
            kind="manual",
            label=f"{s.equipment_model} manual p.{s.page}: {s.title}",
        )
        for s in sections
    ]
    return refs


def _plural(n: int, word: str) -> str:
    many = f"{word}es" if word.endswith(("x", "s", "ch")) else f"{word}s"
    return f"{n} {word if n == 1 else many}"


async def build_guide_events(
    request: GuideRequest, deps: AgentDeps, kb: KnowledgeBase
) -> AsyncIterator[GuideProgress]:
    """Draft a guide, yielding progress for each step and finally the saved guide."""
    began = time.perf_counter()

    def started(step: str) -> GuideProgress:
        return GuideProgress(type="step", step=step, status="started")

    def done(step: str, summary: str) -> GuideProgress:
        return GuideProgress(type="step", step=step, status="done", summary=summary)

    try:
        yield started("understand")
        assets = await asyncio.to_thread(list_assets, kb)
        picked = find_asset([], assets, requested=request.asset_tag) if request.asset_tag else None
        # Both read the report; side by side, the check adds no wait.
        incident, check = await asyncio.gather(
            asyncio.to_thread(tools.structure_incident, request.text, deps),
            asyncio.to_thread(check_report, request, picked, assets, deps),
        )
        named = find_asset([request.text], assets)
        codes = find_codes(request.text)
        question = clarify(request, check, named, picked, codes, assets)
        if question:
            yield done("understand", "One question before drafting")
            telemetry.event(
                "guide_clarify",
                picked=picked.tag if picked else None,
                named=named.tag if named else None,
                machines=len(question.machines),
            )
            yield question
            return
        asset = find_asset(
            [request.text, incident.area_or_equipment], assets, requested=request.asset_tag
        )
        ev = Evidence(incident=incident, codes=codes, asset=asset)
        what = asset.tag if asset else incident.area_or_equipment
        yield done("understand", f"{what}{', alarm ' + ', '.join(codes) if codes else ''}")

        yield started("search_history")
        yield started("search_manuals")

        def history():
            found = tools.search_similar(incident, deps, k=5)
            same = tools.verify_matches(incident, found, deps)
            return same, tools.check_recurrence(incident, same, deps)

        hist_task = asyncio.create_task(asyncio.to_thread(history))
        manual_task = asyncio.create_task(
            asyncio.to_thread(find_sections, incident, codes, asset, deps, kb)
        )
        ev.sections, ev.error_codes = await manual_task
        if ev.sections:
            manual = ev.sections[0]
            yield done(
                "search_manuals",
                f"{_plural(len(ev.sections), 'section')} from the {manual.equipment_model} manual",
            )
        else:
            yield done("search_manuals", "No manual section matched")
        ev.matches, ev.recurrence = await hist_task
        if not ev.matches:
            yield done("search_history", "No past fix for this problem in memory")
        else:
            line = f"{_plural(len(ev.matches), 'past fix')} found"
            rec = ev.recurrence
            if rec and rec.is_repeat:
                line += f", {ordinal(rec.occurrence)} time in {rec.window_months} months"
            if rec and rec.recurred:
                line += f"; {_plural(len(rec.recurred), 'fix')} did not hold"
            yield done("search_history", line)

        yield started("find_parts")
        if ev.asset is None and ev.sections:
            # Only when one machine uses this manual; otherwise parts go by equipment model
            # rather than naming a machine the manager never mentioned.
            same = [a for a in assets if a.manual_id == ev.sections[0].manual_id]
            ev.asset = same[0] if len(same) == 1 else None
        ev.parts = await asyncio.to_thread(find_parts, ev.asset, ev.sections, kb)
        figure_ids = list(dict.fromkeys(f for s in ev.sections for f in s.figure_ids))
        for fid in figure_ids:
            meta = await asyncio.to_thread(kb.figures.get, fid)
            if meta:
                ev.figure_captions[fid] = meta.caption
        yield done(
            "find_parts",
            f"{_plural(len(ev.parts), 'part')} listed for this machine"
            if ev.parts
            else "No spare parts listed for this machine",
        )

        yield started("write_guide")
        guide = await asyncio.to_thread(write_guide, request, ev, deps)
        await asyncio.to_thread(kb.guides.put, [guide])
        line = f"{_plural(len(guide.steps), 'step')}"
        if guide.downtime.manual_minutes:
            line += f", about {format_minutes(guide.downtime.manual_minutes)}"
        yield done("write_guide", line)
        telemetry.event(
            "guide_drafted",
            guide=guide.id,
            asset=guide.asset_tag,
            seconds=round(time.perf_counter() - began, 1),
            steps=len(guide.steps),
            repeat=bool(guide.recurrence and guide.recurrence.is_repeat),
            qa_needed=bool(guide.qa_reasons),
        )
        yield GuideProgress(type="guide", guide=guide)
    except Exception as err:
        if is_overloaded(err):
            telemetry.event("guide_draft_busy", seconds=round(time.perf_counter() - began, 1))
            log.warning("Gemini overloaded after retries: %s", err)
            yield GuideProgress(type="error", detail=BUSY_MESSAGE)
        else:
            log.exception("Guide drafting failed")
            yield GuideProgress(type="error", detail="Something went wrong. Please try again.")
