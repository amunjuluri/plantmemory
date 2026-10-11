"""Rules for repair guides, enforced in code whatever the model writes.

- A guide may only cite the past incidents and manual sections it was given.
- A line with no valid source is labelled general.
- A value with a unit (25 Nm, 121 °C, 8 to 10 mm) must appear in a source the line cites;
  otherwise the line is flagged for the manager and QA. The model cannot invent a torque.
- Figures must come from the offered manual sections; parts must exist in the store.
- Stock is looked up in code: out-of-stock and last-in-store parts are flagged.
- Time estimates come from the manual and past downtimes, never from the model.
"""

import re
import statistics
from collections.abc import Iterable

from app.agent.guardrails import _BRACKET, format_minutes, inline_citations
from app.models import (
    DowntimeEstimate,
    GuideItem,
    GuideItemOut,
    GuidePart,
    GuidePartPick,
    GuideStep,
    GuideStepOut,
    ManualSectionPublic,
    Part,
    SimilarIncident,
)

_NUMBER = r"\d+(?:[.,]\d+)?"
_UNITS = {
    "nm": "nm",
    "n·m": "nm",
    "n": "n",
    "kn": "kn",
    "bar": "bar",
    "mbar": "mbar",
    "mbar/min": "mbar/min",
    "kpa": "kpa",
    "mpa": "mpa",
    "psi": "psi",
    "°c": "c",
    "c": "c",
    "°f": "f",
    "mm": "mm",
    "cm": "cm",
    "µm": "um",
    "um": "um",
    "min": "min",
    "mins": "min",
    "minute": "min",
    "minutes": "min",
    "s": "s",
    "sec": "s",
    "seconds": "s",
    "second": "s",
    "h": "h",
    "hr": "h",
    "hrs": "h",
    "hour": "h",
    "hours": "h",
    "rpm": "rpm",
    "%": "%",
    "ohm": "ohm",
    "ohms": "ohm",
    "ω": "ohm",
    "v": "v",
    "a": "a",
    "w": "w",
    "kw": "kw",
    "µs/cm": "us/cm",
    "us/cm": "us/cm",
    "ml": "ml",
    "l": "l",
    "kg": "kg",
    "g": "g",
    "ppb": "ppb",
    "pa": "pa",
}
_UNIT_RE = "|".join(sorted((re.escape(u) for u in _UNITS), key=len, reverse=True))
_VALUE = re.compile(
    rf"(?<![\w.-])({_NUMBER})(?:\s*(?:to|-|\u2013|and)\s*({_NUMBER}))?\s*({_UNIT_RE})(?![\w/])",
    re.IGNORECASE,
)


def _num(text: str) -> str:
    value = float(text.replace(",", "."))
    return f"{value:g}"


def values_with_units(text: str) -> set[tuple[str, str]]:
    """Every (number, unit) in the text: "8 to 10 mm" gives (8, mm) and (10, mm)."""
    found: set[tuple[str, str]] = set()
    for first, second, unit in _VALUE.findall(text):
        key = _UNITS[unit.lower()]
        found.add((_num(first), key))
        if second:
            found.add((_num(second), key))
    return found


def strip_ids(text: str) -> str:
    """Remove inline [ID] citations from text meant for the shop floor."""
    cleaned = _BRACKET.sub(lambda m: "" if inline_citations(m.group(0)) else m.group(0), text)
    return re.sub(r"\s+([.,;:])", r"\1", re.sub(r"\s{2,}", " ", cleaned)).strip()


def source_texts(
    matches: Iterable[SimilarIncident], sections: Iterable[ManualSectionPublic]
) -> dict[str, str]:
    """The text of every citable source, by id, for checking values."""
    texts: dict[str, str] = {}
    for m in matches:
        r = m.record
        if r is not None:
            fields = [r.description, r.suspected_cause, r.root_cause, r.action_taken]
            texts[m.id] = " ".join(f for f in fields if f)
    for s in sections:
        texts[s.id] = f"{s.title} {s.text}"
    return texts


def _check_item[I: GuideItem](item: I, sources: dict[str, str], extra_text: str = "") -> I:
    """Keep only offered citations, label uncited lines general, flag unsupported values."""
    cited = list(dict.fromkeys([*item.citations, *inline_citations(item.text)]))
    good = [c for c in cited if c in sources]
    flags = [f for f in item.flags if not f.startswith(("Cited ", "Check "))]
    unknown = [c for c in cited if c not in sources]
    if unknown:
        flags.append(f"Cited {', '.join(unknown)}, which was not offered as a source; removed.")
    supported: set[tuple[str, str]] = set()
    for c in good:
        supported |= values_with_units(sources[c])
    for number, unit in sorted(values_with_units(item.text + " " + extra_text) - supported):
        flags.append(
            f"Check “{number} {unit}”: it is not in the sources this line cites."
            if good
            else f"Check “{number} {unit}”: this line has no source."
        )
    return item.model_copy(
        update={
            "text": strip_ids(item.text),
            "citations": good,
            "general": not good,
            "flags": flags,
        }
    )


def check_item(item: GuideItemOut | GuideItem, sources: dict[str, str]) -> GuideItem:
    return _check_item(GuideItem(text=item.text, citations=item.citations), sources)


def check_step(
    step: GuideStepOut | GuideStep, sources: dict[str, str], figures: set[str]
) -> GuideStep:
    caution = strip_ids(step.caution) if step.caution else None
    checked = _check_item(
        GuideStep(text=step.text, citations=step.citations, caution=caution or None),
        sources,
        extra_text=caution or "",
    )
    figure = step.figure_id if step.figure_id in figures else None
    return checked.model_copy(update={"figure_id": figure})


def check_steps(
    steps: Iterable[GuideStepOut | GuideStep], sources: dict[str, str], figures: set[str]
) -> list[GuideStep]:
    """Check every step; a figure is shown once, on the first step that uses it."""
    used: set[str] = set()
    checked = []
    for step in steps:
        if not step.text.strip():
            continue
        result = check_step(step, sources, figures - used)
        if result.figure_id:
            used.add(result.figure_id)
        checked.append(result)
    return checked


def check_parts(
    picks: Iterable[GuidePartPick], stock: dict[str, Part]
) -> tuple[list[GuidePart], list[str]]:
    """Parts with stock from the store, and plain warnings for the manager."""
    parts: list[GuidePart] = []
    flags: list[str] = []
    seen: set[str] = set()
    for pick in picks:
        part = stock.get(pick.part_no.strip())
        if part is None:
            flags.append(f"Part {pick.part_no} is not in the plant's parts list; removed.")
            continue
        if part.part_no in seen:
            continue
        seen.add(part.part_no)
        in_stock = part.stock_qty >= pick.qty
        parts.append(
            GuidePart(
                part_no=part.part_no,
                qty=pick.qty,
                why=pick.why,
                name=part.name,
                unit=part.unit,
                stock_qty=part.stock_qty,
                bin_location=part.bin_location,
                lead_time_days=part.lead_time_days,
                figure_id=part.figure_id,
                in_stock=in_stock,
            )
        )
        lead = f" Lead time {part.lead_time_days} days." if part.lead_time_days else ""
        if not in_stock:
            flags.append(
                f"{part.part_no} {part.name}: {part.stock_qty} in store, {pick.qty} needed."
                f"{lead} Raise a purchase request now."
            )
        elif part.stock_qty == pick.qty:
            flags.append(
                f"{part.part_no} {part.name}: this uses the last one in store.{lead} Reorder."
            )
    return parts, flags


def guide_flags(sections: list[ManualSectionPublic], steps: list[GuideStep]) -> list[str]:
    """Guide-level warnings that do not depend on parts."""
    flags = []
    if not sections:
        flags.append("No manual section matched this breakdown. Check the steps with an engineer.")
    if not steps:
        flags.append("The guide has no steps. Add them before sending it to QA.")
    return flags


def make_estimate(
    manual_minutes: int | None, manual_source: str | None, past: list[int]
) -> DowntimeEstimate:
    """A time estimate from the manual's typical time and past downtimes, with a plain note."""
    median = round(statistics.median(past)) if past else None
    parts = []
    if manual_minutes:
        source = f" [{manual_source}]" if manual_source else ""
        parts.append(f"The manual gives about {format_minutes(manual_minutes)}{source}.")
    if median is not None:
        listed = ", ".join(format_minutes(p) for p in past)
        if len(past) == 1:
            parts.append(f"The last time this happened it took {listed}.")
        else:
            parts.append(
                f"Past repairs of this problem took {listed} (median {format_minutes(median)})."
            )
    estimate = DowntimeEstimate(
        manual_minutes=manual_minutes or None,
        manual_source=manual_source if manual_minutes else None,
        history_minutes=median,
        history_records=len(past),
    )
    if parts:
        estimate.note = " ".join(parts)
    return estimate


def estimate_downtime(
    cited: set[str],
    sections: Iterable[ManualSectionPublic],
    matches: Iterable[SimilarIncident],
    codes: Iterable[str],
) -> DowntimeEstimate:
    """The manual's typical time for the cited procedure, and the median of past downtimes."""
    from app.kb import code_key

    keys = {code_key(c) for c in codes}
    timed = [s for s in sections if s.id in cited and s.repair_minutes]
    for_code = [s for s in timed if keys & {code_key(c) for c in s.error_codes}]
    best = max(for_code or timed, key=lambda s: s.repair_minutes, default=None)
    past = [m.record.downtime_minutes for m in matches if m.record and m.record.downtime_minutes]
    return make_estimate(best.repair_minutes if best else None, best.id if best else None, past)
