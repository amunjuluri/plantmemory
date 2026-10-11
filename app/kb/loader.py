"""Turn a manual (seed JSON or what Gemini read from a PDF) into stored sections and codes."""

import base64
import re
from collections.abc import Iterable

from app.kb import KnowledgeBase, code_key
from app.models import (
    Asset,
    ErrorCode,
    ErrorCodeOut,
    Figure,
    ManualSection,
    ManualSectionOut,
    ManualSummary,
)


def section_id(manual_id: str, page: int, taken: set[str] | None = None) -> str:
    """A citable id such as MAN-RTP37-16; a second section on the same page gets -16B."""
    base = f"MAN-{manual_id}-{page}"
    if taken is None or base not in taken:
        return base
    for suffix in "BCDEFGHIJKLMNOPQRSTUVWXYZ":
        if f"{base}{suffix}" not in taken:
            return f"{base}{suffix}"
    raise ValueError(f"Too many sections on page {page}")


def manual_code(text: str) -> str:
    """A short manual code from a model name, e.g. "Aerodry FBD-120" -> "FBD120"."""
    tokens = re.findall(r"[A-Za-z]+[- ]?\d[\w-]*|\d[\w-]*", text)
    code = re.sub(r"[^A-Z0-9]", "", (tokens[0] if tokens else text).upper())
    return (code or "MANUAL")[:10]


def section_text(section: ManualSection) -> str:
    """What gets embedded for search."""
    codes = f"\nAlarm codes: {', '.join(section.error_codes)}" if section.error_codes else ""
    return (
        f"Equipment: {section.equipment_model} ({', '.join(section.asset_tags)})\n"
        f"Section: {section.title}{codes}\n{section.text}"
    )


def build_manual(
    manual_id: str,
    manual_title: str,
    equipment_model: str,
    asset_tags: list[str],
    sections: Iterable[ManualSectionOut | dict],
    codes: Iterable[ErrorCodeOut | dict],
    figure_ids_by_page: dict[int, list[str]] | None = None,
) -> tuple[list[ManualSection], list[ErrorCode]]:
    """Sections with stable ids, plus alarm codes linked to the section that explains them."""
    common = {
        "manual_id": manual_id,
        "manual_title": manual_title,
        "equipment_model": equipment_model,
        "asset_tags": asset_tags,
    }
    built: list[ManualSection] = []
    taken: set[str] = set()
    for raw in sections:
        data = raw.model_dump() if isinstance(raw, ManualSectionOut) else dict(raw)
        data.pop("figures", None)
        figure_ids = data.pop("figure_ids", None) or []
        if figure_ids_by_page and not figure_ids:
            figure_ids = figure_ids_by_page.get(data["page"], [])
        sid = section_id(manual_id, data["page"], taken)
        taken.add(sid)
        built.append(ManualSection(id=sid, figure_ids=figure_ids, **common, **data))

    # A code links to the section that explains it, not to the alarm list that names it.
    by_code: dict[str, ManualSection] = {}
    for section in sorted(built, key=lambda s: s.kind == "error_codes"):
        for code in section.error_codes:
            by_code.setdefault(code_key(code), section)
    by_page = {s.page: s for s in built}

    error_codes: list[ErrorCode] = []
    for raw in codes:
        data = raw.model_dump() if isinstance(raw, ErrorCodeOut) else dict(raw)
        page = data.pop("page", None)
        key = code_key(data["code"])
        section = by_code.get(key) or (by_page.get(page) if page else None)
        error_codes.append(
            ErrorCode(
                id=f"{manual_id}-{key}",
                code_key=key,
                section_id=section.id if section else None,
                **{k: v for k, v in common.items() if k != "manual_title"},
                **data,
            )
        )
    return built, error_codes


def figure_from_file(meta: dict, data: bytes, mime: str) -> Figure:
    fields = {k: meta.get(k) for k in ("id", "caption", "source", "manual_id", "page")}
    return Figure(mime=mime, data_b64=base64.b64encode(data).decode(), **fields)


def summarize_manuals(kb: KnowledgeBase) -> list[ManualSummary]:
    """One line per manual in the knowledge base."""
    manuals: dict[str, list[ManualSection]] = {}
    for section in kb.sections.all():
        manuals.setdefault(section.manual_id, []).append(section)
    codes: dict[str, int] = {}
    for code in kb.codes.all():
        codes[code.manual_id] = codes.get(code.manual_id, 0) + 1
    summaries = []
    for manual_id, sections in manuals.items():
        first = sections[0]
        summaries.append(
            ManualSummary(
                manual_id=manual_id,
                manual_title=first.manual_title,
                equipment_model=first.equipment_model,
                asset_tags=first.asset_tags,
                sections=len(sections),
                pages=max(s.page for s in sections),
                error_codes=codes.get(manual_id, 0),
                figures=len({f for s in sections for f in s.figure_ids}),
            )
        )
    return sorted(summaries, key=lambda m: m.equipment_model)


def list_assets(kb: KnowledgeBase) -> list[Asset]:
    """Every machine tag that has a manual or spare parts, with its equipment model."""
    assets: dict[str, Asset] = {}
    for manual in summarize_manuals(kb):
        for tag in manual.asset_tags:
            assets[tag] = Asset(
                tag=tag, equipment_model=manual.equipment_model, manual_id=manual.manual_id
            )
    for part in kb.parts.all():
        for tag in part.asset_tags:
            assets.setdefault(tag, Asset(tag=tag, equipment_model=part.equipment_model))
    return sorted(assets.values(), key=lambda a: a.tag)
