"""Machine and instrument logs: separate errors (machine stopped) from warnings, and give
the manager the manual's first actions and a time estimate for each alarm code.

Exported alarm tables (CSV or semicolon lists from an HMI, such as a WinCC alarm log)
are parsed in code. Anything else (controller printouts, free-form event logs) is read
by Gemini. Either way, what each code means comes from the manual's alarm table, and
past fixes are checked by the same Gemini match check as everywhere else.
"""

import csv
import io
import re
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.agent import prompts, tools
from app.agent.tools import AgentDeps
from app.guide.builder import find_asset, find_codes
from app.guide.guardrails import make_estimate
from app.kb import KnowledgeBase, code_key
from app.kb.loader import list_assets
from app.models import (
    ErrorCode,
    LogAnalysis,
    LogCodeSummary,
    LogExtraction,
    LogSeverity,
    ManualSectionPublic,
    StructuredIncident,
)

MAX_LOG_BYTES = 2 * 1024 * 1024
MAX_AI_LINES = 300
MAX_HISTORY_LOOKUPS = 3

_HEADERS = {
    "time": [
        "timestamp",
        "date/time",
        "datetime",
        "date time",
        "time stamp",
        "event time",
        "eventtime",
        "time",
    ],
    "date": ["date"],
    "code": [
        "alarm code",
        "error code",
        "code",
        "alarm id",
        "alarm no",
        "alarm number",
        "msg no",
        "message number",
        "number",
        "event id",
        "id",
        "no.",
    ],
    "text": [
        "alarm text",
        "message text",
        "event text",
        "text",
        "message",
        "description",
        "msg",
        "alarm",
    ],
    "severity": [
        "alarm class",
        "msg class",
        "class",
        "severity",
        "priority",
        "type",
        "level",
        "category",
    ],
    "state": ["state after", "state", "status", "transition", "event"],
}
_ERROR_WORDS = ("error", "fault", "alarm", "critical", "trip", "stop", "abort")
_WARNING_WORDS = ("warn", "caution", "advisory", "notice")
_TIME_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f",
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y %H:%M:%S.%f",
    "%d/%m/%Y %H:%M:%S",
    "%d-%m-%Y %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%d/%m/%Y %H:%M",
)


class InvalidLogError(ValueError):
    """The upload is not a readable text log."""


@dataclass
class Event:
    when: datetime | None
    raw_time: str
    code: str | None
    message: str
    severity: LogSeverity
    state: str  # came, went or acknowledged


def decode(data: bytes) -> str:
    if len(data) > MAX_LOG_BYTES:
        raise InvalidLogError("Log is larger than 2 MB. Export a shorter time range.")
    if b"\x00" in data[:2000] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise InvalidLogError("That file is not a text log. Export the log as CSV or text.")
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            text = data.decode(encoding)
            if encoding == "utf-16" and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
                continue
            return text
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def parse_time(text: str) -> datetime | None:
    text = text.strip().replace("  ", " ")
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def severity_of(label: str, code: str | None, message: str) -> LogSeverity:
    """Map a class/severity label (or, failing that, the code prefix) to error/warning/info."""
    word = label.strip().lower()
    if word.isdigit():  # numeric severity, e.g. 1 to 1000 in FactoryTalk alarm logs
        n = int(word)
        return "error" if n >= 667 else "warning" if n >= 334 else "info"
    if any(w in word for w in _WARNING_WORDS):
        return "warning"
    if any(w in word for w in _ERROR_WORDS):
        return "error"
    if word:
        return "info"
    prefix = (code or "").upper()[:1]
    if prefix == "E":
        return "error"
    if prefix == "W":
        return "warning"
    lowered = message.lower()
    if any(w in lowered for w in _WARNING_WORDS):
        return "warning"
    return "error" if any(w in lowered for w in _ERROR_WORDS) else "info"


def state_of(text: str) -> str:
    word = text.strip().lower()
    if any(w in word for w in ("went", "out", "clear", "gone", "(o)", "inactive")):
        return "went"
    if any(w in word for w in ("ack", "quit", "(a)", "(q)")):
        return "acknowledged"
    return "came"


def _column(header: list[str], kind: str) -> int | None:
    lowered = [h.strip().lower() for h in header]
    for name in _HEADERS[kind]:
        if name in lowered:
            return lowered.index(name)
    return None


def parse_table(lines: list[str]) -> list[Event] | None:
    """Parse an exported alarm table. None if the lines do not look like one."""
    if len(lines) < 2:
        return None
    sample = "\n".join(lines[:20])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        return None
    rows = list(csv.reader(io.StringIO("\n".join(lines)), dialect))
    header = rows[0]
    cols = {kind: _column(header, kind) for kind in _HEADERS}
    if cols["text"] is None or (cols["time"] is None and cols["date"] is None):
        return None
    if cols["time"] == cols["date"]:
        cols["date"] = None

    def cell(row: list[str], kind: str) -> str:
        i = cols[kind]
        return row[i].strip() if i is not None and i < len(row) else ""

    events = []
    for row in rows[1:]:
        if not any(c.strip() for c in row):
            continue
        message = cell(row, "text")
        raw_time = " ".join(p for p in (cell(row, "date"), cell(row, "time")) if p)
        code = (find_codes(message) or find_codes(cell(row, "code")) or [None])[0]
        if code is None and cell(row, "code"):
            code = cell(row, "code")
        events.append(
            Event(
                when=parse_time(raw_time),
                raw_time=raw_time,
                code=code,
                message=message,
                severity=severity_of(cell(row, "severity"), code, message),
                state=state_of(cell(row, "state")),
            )
        )
    return events


def parse_with_ai(lines: list[str], deps: AgentDeps) -> tuple[list[Event], str | None]:
    """Let Gemini read a log format code does not know."""
    prompt = prompts.LOG_PROMPT.format(
        plant=deps.settings.plant_type, lines="\n".join(lines[-MAX_AI_LINES:])
    )
    extraction = deps.llm.generate(prompt, LogExtraction, thinking="low")
    events = [
        Event(
            when=parse_time(e.timestamp) if e.timestamp else None,
            raw_time=e.timestamp or "",
            code=(find_codes(e.code or "") or [e.code])[0] if e.code else None,
            message=e.message,
            severity=e.severity,
            state=state_of(e.state or ""),
        )
        for e in extraction.events
    ]
    return events, extraction.equipment


def _iso(when: datetime | None, raw: str) -> str | None:
    return when.isoformat(timespec="seconds") if when else (raw or None)


def warning_trend(times: list[datetime], end: datetime | None) -> str | None:
    """'14 times; 9 in the last hour, rising' when a warning is getting more frequent."""
    if len(times) < 3 or end is None:
        return None
    last = sum(1 for t in times if t > end - timedelta(hours=1))
    before = sum(1 for t in times if end - timedelta(hours=2) < t <= end - timedelta(hours=1))
    if last >= 3 and last > before * 1.5:
        return f"{len(times)} times; {last} in the last hour of the log, up from {before}: rising."
    return f"{len(times)} times in the log."


def _lookup_code(code: str | None, asset_tag: str | None, kb: KnowledgeBase) -> ErrorCode | None:
    if not code:
        return None
    entries = kb.codes.all(code_key=code_key(code))
    if not entries:
        return None
    if asset_tag:
        entries = [e for e in entries if asset_tag in e.asset_tags] or entries
    return entries[0] if len(entries) == 1 or asset_tag else None


def summarize_codes(
    events: Iterable[Event], asset_tag: str | None, kb: KnowledgeBase
) -> tuple[list[LogCodeSummary], list[LogCodeSummary], int, datetime | None]:
    """Group events by code: (errors, warnings, info count, end of log)."""
    events = list(events)
    times = [e.when for e in events if e.when]
    end = max(times) if times else None
    groups: dict[str, list[Event]] = {}
    info = 0
    for e in events:
        if e.severity == "info":
            info += 1
            continue
        if e.state != "came":
            continue
        groups.setdefault(e.code or e.message[:60], []).append(e)

    errors, warnings = [], []
    for group in groups.values():
        first = group[0]
        entry = _lookup_code(first.code, asset_tag, kb)
        severity: LogSeverity = (
            entry.severity
            if entry
            else ("error" if any(e.severity == "error" for e in group) else "warning")
        )
        section = kb.sections.get(entry.section_id) if entry and entry.section_id else None
        stamps = sorted(e.when for e in group if e.when)
        summary = LogCodeSummary(
            code=first.code,
            message=entry.title if entry else first.message,
            severity=severity,
            count=len(group),
            first_seen=_iso(stamps[0] if stamps else None, first.raw_time),
            last_seen=_iso(stamps[-1] if stamps else None, group[-1].raw_time),
            stops_machine=entry.stops_machine if entry else severity == "error",
            manual=entry,
            section=(
                ManualSectionPublic.model_validate(section.model_dump(exclude={"embedding"}))
                if section
                else None
            ),
            immediate_actions=entry.first_actions if entry else [],
            likely_causes=entry.likely_causes if entry else [],
            guide_prompt="",
        )
        if severity == "warning":
            summary.trend = warning_trend(stamps, end)
            warnings.append(summary)
        else:
            errors.append(summary)
    key = lambda s: s.last_seen or ""  # noqa: E731
    return (
        sorted(errors, key=key, reverse=True),
        sorted(warnings, key=lambda s: -s.count),
        info,
        end,
    )


def link_warnings(errors: list[LogCodeSummary], warnings: list[LogCodeSummary]) -> None:
    """Note when the manual says a warning often comes before an error in this log."""
    error_codes = {code_key(e.code): e.code for e in errors if e.code}
    for w in warnings:
        if not w.section or w.section.kind == "error_codes":
            continue
        for code in find_codes(w.section.text):
            if code_key(code) in error_codes:
                note = (
                    f"The manual says this often comes before {code}, which stopped the "
                    f"machine in this log [{w.section.id}]."
                )
                w.trend = f"{w.trend} {note}" if w.trend else note


def guide_prompt(
    s: LogCodeSummary, machine: str, warnings: list[LogCodeSummary], start: str | None
) -> str:
    """A breakdown report for the repair guide, written from the log."""
    stopped = "Machine stopped" if s.stops_machine else "Machine still running"
    parts = [f"{machine}: alarm {s.code or ''} {s.message}.".replace("  ", " ")]
    parts.append(f"{stopped} at {s.last_seen}." if s.last_seen else f"{stopped}.")
    if s.count > 1:
        parts.append(f"Seen {s.count} times in the log since {start}.")
    before = [w for w in warnings if w.trend and "rising" in w.trend]
    if before:
        listed = ", ".join(f"{w.code} {w.message} ({w.count} times)" for w in before[:3])
        parts.append(f"Warnings rising before the stop: {listed}.")
    return " ".join(parts)


def add_history(errors: list[LogCodeSummary], machine: str, deps: AgentDeps) -> None:
    """Past fixes and time estimates for the most recent errors (Gemini checks each match)."""

    def lookup(s: LogCodeSummary):
        incident = StructuredIncident(
            date=date.today(),
            area_or_equipment=machine,
            description=f"Alarm {s.code}: {s.message}. Machine stopped.",
        )
        found = tools.search_similar(incident, deps, k=5)
        return tools.verify_matches(incident, found, deps)

    targets = errors[:MAX_HISTORY_LOOKUPS]
    if targets:
        with ThreadPoolExecutor(max_workers=len(targets)) as pool:
            for s, matches in zip(targets, pool.map(lookup, targets), strict=True):
                s.history = matches
    for s in errors:
        past = [
            m.record.downtime_minutes for m in s.history if m.record and m.record.downtime_minutes
        ]
        s.downtime = make_estimate(
            s.manual.repair_minutes if s.manual else None,
            s.manual.section_id if s.manual else None,
            past,
        )


def analyze_log(
    data: bytes,
    filename: str | None,
    deps: AgentDeps,
    kb: KnowledgeBase,
    asset_tag: str | None = None,
) -> LogAnalysis:
    """Read a log file and explain every alarm in it."""
    text = decode(data)
    lines = [ln.rstrip() for ln in text.splitlines()]
    header_lines = [ln.lstrip("#").strip() for ln in lines if ln.startswith("#")]
    body = [ln for ln in lines if ln.strip() and not ln.startswith("#")]
    if not body:
        raise InvalidLogError("The log is empty.")

    notes: list[str] = []
    events = parse_table(body)
    parser = "table"
    equipment_hint = None
    if not events:
        parser = "ai"
        events, equipment_hint = parse_with_ai(body, deps)
        if len(body) > MAX_AI_LINES:
            notes.append(f"Only the last {MAX_AI_LINES} lines were read.")
    if not events:
        raise InvalidLogError("No alarms or events found in that file.")

    assets = list_assets(kb)
    asset = find_asset([*header_lines, equipment_hint or "", filename or ""], assets, asset_tag)
    errors, warnings, info, end = summarize_codes(events, asset.tag if asset else None, kb)
    if asset is None:
        manuals = {s.manual.manual_id for s in errors + warnings if s.manual}
        if len(manuals) == 1:
            manual_id = manuals.pop()
            candidates = [a for a in assets if a.manual_id == manual_id]
            asset = candidates[0] if len(candidates) == 1 else None
            if asset is None and candidates:
                notes.append(
                    f"The codes match the {candidates[0].equipment_model} manual. "
                    "Pick the machine to get its parts."
                )
    machine = asset.tag if asset else (equipment_hint or "Machine")
    times = sorted(e.when for e in events if e.when)
    start = _iso(times[0], "") if times else None

    link_warnings(errors, warnings)
    add_history(errors, machine, deps)
    for s in errors + warnings:
        s.guide_prompt = guide_prompt(s, machine, warnings, start)
    unknown = [s.code for s in errors + warnings if s.code and not s.manual]
    if unknown:
        notes.append(f"Not in any manual's alarm table: {', '.join(unknown[:8])}.")
    return LogAnalysis(
        source_ref=re.sub(r"[^\w.\- ]", "_", (filename or "log.txt"))[:120],
        parser=parser,
        asset_tag=asset.tag if asset else None,
        equipment_model=asset.equipment_model if asset else None,
        start=start,
        end=_iso(end, "") if end else None,
        total_events=len(events),
        errors=errors,
        warnings=warnings,
        info_events=info,
        notes=notes,
    )
