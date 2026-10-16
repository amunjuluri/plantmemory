"""Pydantic models shared by the API, agent and stores."""

import datetime as dt
from datetime import UTC, date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Industry = Literal["paper", "pharma", "healthcare", "generic"]
Outcome = Literal["resolved", "recurred", "unknown"]
Source = Literal[
    "seed",
    "logbook_photo",
    "voice_note",
    "approved_draft",
    "cmms_import",
    "guide_closure",
    "public_record",
]
# A public record (an FDA report from another company or hospital) shows what fixed a
# problem elsewhere. It is never counted as this plant's own history: repeat warnings
# come only from the plant's own records.


class Model(BaseModel):
    """Base for every API model. Response schemas mark defaulted fields as always present."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


def _now() -> datetime:
    return datetime.now(UTC)


class IncidentCore(Model):
    """Fields that describe an incident, whether new or historical."""

    industry: Industry = "generic"
    date: date
    area_or_equipment: str
    description: str = Field(description="Free text, as originally written.")
    suspected_cause: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    downtime_minutes: int | None = Field(default=None, ge=0)


class StructuredIncident(IncidentCore):
    """A new incident as understood by the agent. No outcome yet."""


class IncidentPublic(IncidentCore):
    """An incident record as returned to clients (no embedding)."""

    id: str
    outcome: Outcome = "unknown"
    source: Source = "seed"
    source_ref: str | None = None
    confidence_flags: list[str] = Field(
        default_factory=list, description="Fields the AI was unsure about."
    )
    created_at: datetime = Field(default_factory=_now)


class IncidentRecord(IncidentPublic):
    """An incident record as stored, including its embedding vector."""

    embedding: list[float] | None = Field(default=None, repr=False)


class SimilarIncident(Model):
    """A past incident returned by search, with why it matches."""

    id: str
    score: float = Field(ge=-1.0, le=1.0)
    why: str = ""
    record: IncidentPublic | None = None


class Recurrence(Model):
    """How often this kind of incident has happened before, worked out in code."""

    window_months: int
    in_window: list[str] = Field(
        default_factory=list, description="Similar records dated within the window."
    )
    recurred: list[str] = Field(
        default_factory=list, description="Similar records whose fix did not hold."
    )
    is_repeat: bool = False
    occurrence: int = Field(
        default=1, description="Which time this is within the window: 3 means third time."
    )
    downtime_minutes: int = Field(
        default=0, description="Downtime recorded for the similar incidents in the window."
    )
    downtime_records: int = Field(
        default=0, description="How many of those incidents recorded a downtime."
    )
    note: str | None = None


class DraftItem(Model):
    """One suggested check or action, with the records that support it."""

    text: str
    citations: list[str] = Field(default_factory=list)
    general: bool = Field(
        default=False, description="True when this is general advice, not from past records."
    )


class MatchExplanation(Model):
    """The model's one-line reason a past record matches the new incident."""

    id: str
    why: str


class MatchVerdict(Model):
    """The model's judgement of one search candidate."""

    id: str
    same_problem: bool
    why: str = Field(description="One sentence: the shared problem, or the key difference.")


class MatchCheck(Model):
    """The model's judgement of every search candidate. Code decides what to keep."""

    verdicts: list[MatchVerdict]


class DraftContent(Model):
    """The part of a draft the model writes. Code checks it and builds the `Draft`."""

    summary: str
    match_explanations: list[MatchExplanation] = Field(default_factory=list)
    suggested_checks: list[DraftItem] = Field(default_factory=list)
    suggested_actions: list[DraftItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


REVIEW_NOTICE = "AI-generated draft. A qualified person must review it before anyone acts on it."


class Draft(Model):
    """A troubleshooting note or investigation draft for a human to review."""

    incident: StructuredIncident
    summary: str
    no_match: bool = Field(default=False, description="True when no past incident was similar.")
    similar_incidents: list[SimilarIncident] = Field(default_factory=list)
    recurrence_note: str | None = None
    recurrence: Recurrence | None = Field(
        default=None, description="Counts behind recurrence_note, for the UI."
    )
    suggested_checks: list[DraftItem] = Field(default_factory=list)
    suggested_actions: list[DraftItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    cause_flags: list[str] = Field(
        default_factory=list, description="Shallow causes (e.g. 'operator error') to dig into."
    )
    citations: list[str] = Field(default_factory=list, description="All record ids cited.")
    status: Literal["draft", "approved"] = "draft"
    review_notice: str = REVIEW_NOTICE


# --- API request/response bodies ---


class AnalyzeRequest(Model):
    """A new incident described in free text."""

    text: str = Field(min_length=5, max_length=8000)
    industry: Industry | None = Field(
        default=None, description="Restrict search to one industry. Omit to search all."
    )


class ApproveRequest(Model):
    """A reviewed (possibly edited) draft, plus what was actually found and done."""

    draft: Draft
    root_cause: str | None = None
    action_taken: str | None = None
    outcome: Outcome = "unknown"
    downtime_minutes: int | None = Field(default=None, ge=0)


class IncidentPage(Model):
    """One page of incident records."""

    items: list[IncidentPublic]
    total: int
    offset: int
    limit: int


# --- Logbook ingest ---


class ExtractedIncident(Model):
    """One logbook entry as read by the model from a photo."""

    industry: Industry = "generic"
    date: dt.date | None = Field(default=None, description="Null if no date is readable.")
    area_or_equipment: str
    description: str
    suspected_cause: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    outcome: Outcome = "unknown"
    downtime_minutes: int | None = Field(default=None, ge=0)
    confidence_flags: list[str] = Field(
        default_factory=list, description="Names of fields that were hard to read or unsure."
    )


class LogbookExtraction(Model):
    """Everything the model read from one logbook page."""

    records: list[ExtractedIncident] = Field(default_factory=list)
    page_notes: str | None = Field(
        default=None, description="Anything a reviewer should know, e.g. a torn corner."
    )


class IngestResult(Model):
    """Records read from a photo, not yet saved. A person reviews, then confirms."""

    source_ref: str
    records: list[IncidentPublic]
    page_notes: str | None = None
    glossary_terms: int = Field(default=0, description="Glossary entries given to the model.")


class ConfirmRequest(Model):
    """Reviewed (possibly edited) records from a logbook photo or CMMS export, to be saved."""

    records: list[IncidentPublic] = Field(min_length=1, max_length=50)


class CmmsMapping(Model):
    """Which columns of a CMMS export hold which incident field. The model proposes it;
    code applies it to every row, so no row is ever paraphrased."""

    system: str | None = Field(
        default=None, description='What the export looks like, e.g. "SAP PM notification list".'
    )
    id_column: str | None = None
    date_column: str
    equipment_columns: list[str] = Field(default_factory=list)
    description_columns: list[str] = Field(default_factory=list)
    cause_columns: list[str] = Field(default_factory=list)
    action_columns: list[str] = Field(default_factory=list)
    downtime_column: str | None = None
    downtime_unit: Literal["minutes", "hours", "days"] = "hours"
    status_column: str | None = None
    completed_values: list[str] = Field(
        default_factory=list, description="Status values meaning the work was completed."
    )


class CmmsImportResult(IngestResult):
    """Rows read from a CMMS export, not yet saved."""

    mapping: CmmsMapping
    rows: int = Field(description="Data rows in the file.")
    skipped: list[str] = Field(default_factory=list, description="Why rows were skipped.")


# --- Knowledge base: equipment manuals, error codes, spare parts, figures ---

SectionKind = Literal[
    "safety", "troubleshooting", "procedure", "error_codes", "maintenance", "general"
]


class ManualSectionCore(Model):
    """One section of an equipment manual, as stored for search."""

    manual_id: str = Field(description='Short manual code, e.g. "RTP37".')
    manual_title: str
    equipment_model: str
    asset_tags: list[str] = Field(
        default_factory=list, description="Plant machines this manual covers, e.g. TP-01."
    )
    page: int = Field(ge=1)
    title: str
    kind: SectionKind = "general"
    text: str
    error_codes: list[str] = Field(default_factory=list)
    repair_minutes: int | None = Field(
        default=None, ge=0, description="Typical time for this procedure, if the manual says."
    )
    figure_ids: list[str] = Field(default_factory=list)


class ManualSectionPublic(ManualSectionCore):
    """A manual section as returned to clients (no embedding)."""

    id: str


class ManualSection(ManualSectionPublic):
    """A manual section as stored, with its embedding."""

    embedding: list[float] | None = Field(default=None, repr=False)


class ErrorCode(Model):
    """One row of a manual's alarm table: what the code means and what to do first."""

    id: str
    code: str = Field(description='As shown on the machine, e.g. "E-104".')
    code_key: str = Field(description='Normalised for lookup, e.g. "E104".')
    manual_id: str
    equipment_model: str
    asset_tags: list[str] = Field(default_factory=list)
    title: str
    severity: Literal["warning", "error"]
    stops_machine: bool
    likely_causes: list[str] = Field(default_factory=list)
    first_actions: list[str] = Field(default_factory=list)
    repair_minutes: int | None = Field(default=None, ge=0)
    section_id: str | None = Field(default=None, description="Section with the full procedure.")


class ManualPick(Model):
    """The model's choice of manual for a report that names no machine. Code checks the id."""

    manual_id: str | None = Field(
        description="Id of the manual for this report's equipment, or null if none is."
    )
    why: str = Field(description="One sentence: the equipment both are about, or the difference.")


class Part(Model):
    """A spare part with its stock in the plant store."""

    part_no: str
    name: str
    description: str = ""
    equipment_model: str
    asset_tags: list[str] = Field(default_factory=list)
    stock_qty: int = Field(default=0, ge=0)
    unit: str = "pc"
    bin_location: str = ""
    lead_time_days: int | None = Field(default=None, ge=0)
    figure_id: str | None = None


class FigureMeta(Model):
    """A picture: a figure from a manual or a photo of a part."""

    id: str
    caption: str
    mime: str = "image/png"
    source: Literal["manual", "part"] = "manual"
    manual_id: str | None = None
    page: int | None = None


class Figure(FigureMeta):
    """A figure with its image bytes, base64-encoded (fits in one Firestore document)."""

    data_b64: str = Field(repr=False)


class ManualSummary(Model):
    """One manual in the knowledge base."""

    manual_id: str
    manual_title: str
    equipment_model: str
    asset_tags: list[str]
    sections: int
    pages: int
    error_codes: int
    figures: int


class Asset(Model):
    """A machine the plant has a manual or spare parts for."""

    tag: str
    equipment_model: str
    manual_id: str | None = None


# --- Repair guides ---

GuideStatus = Literal[
    "draft", "in_review", "approved", "rejected", "closed", "released", "withdrawn"
]
GUIDE_NOTICE = (
    "AI-drafted from plant records and equipment manuals, then checked and approved by a "
    "person. Only an approved, printed copy may be used on the shop floor."
)
# What QA confirms before a repaired machine goes back to production (line clearance).
RELEASE_CHECKS = (
    "Machine and area cleaned after the repair",
    "All tools, old parts and loose items removed",
    "Line clearance done; the machine can restart",
)


class GuideItem(Model):
    """A safety point, restart check or similar line, with its sources."""

    text: str
    citations: list[str] = Field(default_factory=list)
    general: bool = Field(default=False, description="True when no source supports it.")
    flags: list[str] = Field(
        default_factory=list, description="Warnings added by code for the reviewer."
    )


class GuideStep(GuideItem):
    """One numbered repair step."""

    caution: str | None = None
    figure_id: str | None = None


class GuidePart(Model):
    """A spare part the guide needs, with stock looked up by code."""

    part_no: str
    qty: int = Field(default=1, ge=1)
    why: str = ""
    name: str = ""
    unit: str = "pc"
    stock_qty: int = 0
    bin_location: str = ""
    lead_time_days: int | None = None
    figure_id: str | None = None
    in_stock: bool = True


class SourceRef(Model):
    """Something a guide may cite: a past incident or a manual section."""

    id: str
    kind: Literal["incident", "manual"]
    label: str


class DowntimeEstimate(Model):
    """How long the repair may take, from the manual and from past fixes. Worked out in code."""

    manual_minutes: int | None = None
    manual_source: str | None = Field(default=None, description="Section id the time came from.")
    history_minutes: int | None = Field(default=None, description="Median of past downtimes.")
    history_records: int = 0
    note: str = "No time estimate: neither the manual nor past records give one."


class GuideTranslation(Model):
    """The guide's text in one shop-floor language, item for item."""

    language: str
    language_name: str
    title: str
    summary: str
    safety: list[str]
    steps: list[str]
    step_cautions: list[str]
    restart_checks: list[str]
    escalate_if: list[str]
    flags: list[str] = Field(
        default_factory=list, description="Lines QA should check against the English."
    )
    added_by: str | None = Field(
        default=None,
        description="Who added this language after approval. Such a translation was not "
        "seen by QA, so it prints only if code found no flags.",
    )


class GuideEvent(Model):
    """One entry in a guide's audit trail."""

    at: datetime = Field(default_factory=_now)
    by: str
    action: Literal[
        "created",
        "edited",
        "submitted",
        "approved",
        "rejected",
        "translated",
        "printed",
        "closed",
        "released",
        "withdrawn",
    ]
    comment: str | None = None


class Guide(Model):
    """A repair guide for one breakdown: drafted by AI, checked and approved by the manager
    (or by QA when it needs it), printed for the workers, closed with what was actually
    done, then released back to production by QA."""

    id: str
    status: GuideStatus = "draft"
    version: int = 1
    request: str = Field(description="The manager's description, as given.")
    incident: StructuredIncident
    asset_tag: str | None = None
    equipment_model: str | None = None
    error_codes: list[str] = Field(default_factory=list)
    title: str
    summary: str
    safety: list[GuideItem] = Field(default_factory=list)
    steps: list[GuideStep] = Field(default_factory=list)
    parts: list[GuidePart] = Field(default_factory=list)
    restart_checks: list[GuideItem] = Field(default_factory=list)
    escalate_if: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    similar_incidents: list[SimilarIncident] = Field(default_factory=list)
    recurrence: Recurrence | None = None
    recurrence_note: str | None = None
    manual_sections: list[ManualSectionPublic] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    downtime: DowntimeEstimate = Field(default_factory=DowntimeEstimate)
    flags: list[str] = Field(default_factory=list)
    qa_reasons: list[str] = Field(
        default_factory=list,
        description="Why QA must approve before it is printed. Empty: the manager may approve.",
    )
    translations: list[GuideTranslation] = Field(default_factory=list)
    events: list[GuideEvent] = Field(default_factory=list)
    copies_printed: int = 0
    closure_record_id: str | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    notice: str = GUIDE_NOTICE


class GuideSummary(Model):
    """A guide in a list."""

    id: str
    status: GuideStatus
    version: int
    title: str
    asset_tag: str | None
    author: str | None
    steps: int
    copies_printed: int
    flags: int
    created_at: datetime
    updated_at: datetime


class GuideItemOut(Model):
    """A line the model writes, citing sources by id."""

    text: str
    citations: list[str]


class GuideStepOut(GuideItemOut):
    """A step the model writes."""

    caution: str | None
    figure_id: str | None


class GuidePartPick(Model):
    """A part picked from the offered list."""

    part_no: str
    qty: int = Field(ge=1)
    why: str = ""


class GuideContent(Model):
    """The part of a guide the model writes. Code checks it and builds the `Guide`.

    Every list is required (it may be empty), so the model cannot skip parts or checks."""

    title: str
    summary: str
    safety: list[GuideItemOut]
    steps: list[GuideStepOut]
    parts: list[GuidePartPick]
    restart_checks: list[GuideItemOut]
    escalate_if: list[str]
    open_questions: list[str]


class TranslationOut(Model):
    """The model's translation of a guide into one language."""

    title: str
    summary: str
    safety: list[str]
    steps: list[str]
    step_cautions: list[str]
    restart_checks: list[str]
    escalate_if: list[str]


class GuideRequest(Model):
    """A breakdown described by the manager, typed or from voice intake or an alarm log."""

    text: str = Field(min_length=5, max_length=8000)
    asset_tag: str | None = Field(default=None, max_length=40)
    by: str = Field(default="Manager", min_length=1, max_length=80)


SignerName = Annotated[
    str, Field(min_length=1, max_length=80, description="Name of the person acting.")
]


class GuideEdit(Model):
    """The manager's edited guide content. Code re-checks sources, parts and figures."""

    by: SignerName
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(max_length=4000)
    safety: list[GuideItem]
    steps: list[GuideStep] = Field(min_length=1, max_length=40)
    parts: list[GuidePartPick] = Field(default_factory=list, max_length=30)
    restart_checks: list[GuideItem] = Field(default_factory=list)
    escalate_if: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    note: str | None = Field(
        default=None, max_length=2000, description="Shown in the audit trail with the edit."
    )
    base_updated_at: datetime | None = Field(
        default=None,
        description="The guide's `updated_at` when editing began. If the guide has changed "
        "since, the edit is refused rather than overwriting someone else's changes.",
    )


class GuideRevisionOut(Model):
    """The model's answer to a change the manager asked for, by voice or typed."""

    transcript: str
    language: str | None
    understood: bool
    reply: str | None
    changes: list[str]
    content: GuideContent


class GuideRevision(Model):
    """A proposed change to a guide. Nothing is saved: the manager keeps or discards it."""

    transcript: str = Field(description="What the manager asked, in their own words.")
    language: str | None = None
    reply: str | None = Field(
        default=None,
        description="Set when nothing was changed: a question or the reason, in the "
        "manager's language.",
    )
    changes: list[str] = Field(default_factory=list, description="One line per change.")
    warnings: list[str] = Field(
        default_factory=list, description="What the change means for checks, worked out in code."
    )
    proposal: Guide | None = Field(
        default=None, description="The guide with the change, re-checked like an edit."
    )


class GuideAction(Model):
    """Submit for review or record a printed copy."""

    by: SignerName
    comment: str | None = Field(default=None, max_length=2000)


class GuidePrint(GuideAction):
    """A printed copy, and the languages on it besides English."""

    languages: list[str] = Field(default_factory=list, max_length=20)


class GuideTranslate(Model):
    """Add one more shop-floor language to an approved guide."""

    by: SignerName
    language: str = Field(min_length=2, max_length=3, description="ISO 639-1 code, e.g. ta.")


class GuideReview(Model):
    """QA's decision. A rejection must say why."""

    by: SignerName
    decision: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=2000)


class GuideRelease(Model):
    """QA's line clearance after the repair: every check confirmed."""

    by: SignerName
    checks: list[str] = Field(default_factory=list, max_length=10)
    comment: str | None = Field(default=None, max_length=2000)


class GuideWithdraw(Model):
    """Take back a guide that is not needed: the machine restarted, it was reported by
    mistake, or it repeats another guide."""

    by: SignerName
    reason: str = Field(min_length=3, max_length=2000)


class GuideClose(Model):
    """What was actually done. Saved to plant memory so the next search finds it."""

    by: SignerName
    action_taken: str = Field(min_length=3, max_length=4000)
    root_cause: str | None = Field(default=None, max_length=2000)
    outcome: Outcome = "resolved"
    downtime_minutes: int | None = Field(default=None, ge=0, le=100_000)
    parts_used: str | None = Field(default=None, max_length=1000)


class GuideProgress(Model):
    """One update while a guide is drafted: a step starting or finishing, then the guide."""

    type: Literal["step", "guide", "error"]
    step: str | None = None
    status: Literal["started", "done", "error"] | None = None
    summary: str | None = None
    detail: str | None = None
    guide: Guide | None = None


# --- Voice intake ---

IntakeMode = Literal["breakdown", "closure"]


class IntakeFields(Model):
    """What the manager has said so far. Values in English; codes and numbers as spoken."""

    equipment: str | None = None
    symptom: str | None = None
    machine_stopped: bool | None = None
    error_code: str | None = None
    started: str | None = None
    product_or_batch: str | None = None
    already_tried: str | None = None
    action_taken: str | None = None
    root_cause: str | None = None
    parts_used: str | None = None
    downtime_minutes: int | None = Field(default=None, ge=0)
    outcome: Outcome | None = None


class IntakeMessage(Model):
    role: Literal["manager", "assistant"]
    text: str


class IntakeState(Model):
    """The conversation so far. The client keeps it and sends it back each turn."""

    mode: IntakeMode = "breakdown"
    fields: IntakeFields = Field(default_factory=IntakeFields)
    history: list[IntakeMessage] = Field(default_factory=list, max_length=40)
    language: str | None = None
    turns: int = 0


class IntakeTurnOut(Model):
    """What the model heard in one turn."""

    transcript: str = Field(description="What the manager said, in their own language.")
    language: str = Field(description='ISO 639-1 code of the language spoken, e.g. "te".')
    fields: IntakeFields
    question: str | None = Field(
        default=None, description="Next question, in the manager's language."
    )


class IntakeTurnResult(Model):
    """The updated conversation, what is still missing, and a summary once complete."""

    state: IntakeState
    transcript: str
    question: str | None
    missing: list[str]
    done: bool
    summary: str = Field(description="The report so far, in English, ready for a guide.")


# --- Instrument and machine logs ---

LogSeverity = Literal["error", "warning", "info"]


class LogEventOut(Model):
    """One log line as read by the model (for formats code cannot parse)."""

    timestamp: str | None = Field(default=None, description="ISO 8601 if readable.")
    code: str | None = None
    message: str
    severity: LogSeverity
    state: str | None = None


class LogExtraction(Model):
    events: list[LogEventOut] = Field(default_factory=list)
    equipment: str | None = None


class LogCodeSummary(Model):
    """Everything known about one alarm code in the log."""

    code: str | None
    message: str
    severity: LogSeverity
    count: int
    first_seen: str | None
    last_seen: str | None
    stops_machine: bool
    trend: str | None = None
    manual: ErrorCode | None = None
    section: ManualSectionPublic | None = None
    immediate_actions: list[str] = Field(default_factory=list)
    likely_causes: list[str] = Field(default_factory=list)
    downtime: DowntimeEstimate | None = None
    history: list[SimilarIncident] = Field(default_factory=list)
    guide_prompt: str = Field(description="A breakdown report to start a repair guide from.")


class LogAnalysis(Model):
    """A machine or instrument log, split into errors (machine stopped) and warnings."""

    source_ref: str
    parser: Literal["table", "ai"]
    asset_tag: str | None = None
    equipment_model: str | None = None
    start: str | None = None
    end: str | None = None
    total_events: int
    errors: list[LogCodeSummary] = Field(default_factory=list)
    warnings: list[LogCodeSummary] = Field(default_factory=list)
    info_events: int = 0
    notes: list[str] = Field(default_factory=list)


# --- Manual upload ---


class FigureBox(Model):
    caption: str
    box_2d: list[int] = Field(
        description="[ymin, xmin, ymax, xmax], each 0 to 1000, relative to the page."
    )


class ManualSectionOut(Model):
    page: int = Field(ge=1)
    title: str
    kind: SectionKind = "general"
    text: str
    error_codes: list[str] = Field(default_factory=list)
    repair_minutes: int | None = None
    figures: list[FigureBox] = Field(default_factory=list)


class ErrorCodeOut(Model):
    code: str
    title: str
    severity: Literal["warning", "error"]
    stops_machine: bool
    likely_causes: list[str] = Field(default_factory=list)
    first_actions: list[str] = Field(default_factory=list)
    repair_minutes: int | None = None
    page: int | None = None


class ManualExtraction(Model):
    """Everything the model read from a manual PDF."""

    title: str
    equipment_model: str
    sections: list[ManualSectionOut] = Field(default_factory=list)
    error_codes: list[ErrorCodeOut] = Field(default_factory=list)


class ManualUploadResult(Model):
    summary: ManualSummary
    sections: list[ManualSectionPublic]


# --- Plant status ---

MachineState = Literal["running", "stopped", "awaiting_release"]


class MachineStatus(Model):
    """One machine now, worked out from its repair guides."""

    tag: str
    equipment_model: str | None = None
    state: MachineState
    stage: GuideStatus | None = Field(
        default=None, description="Where the guide for this stop stands; none when running."
    )
    copies_printed: int = 0
    guide_id: str | None = Field(default=None, description="The guide to open for this stop.")
    guide_title: str | None = None
    open_guides: int = Field(default=0, description="Guides not yet released or withdrawn.")
    since: datetime | None = Field(
        default=None,
        description="Stopped: when the first open guide was drafted. Running: when it was "
        "last released to production.",
    )


class PlantStatus(Model):
    """Which machines are running, stopped or waiting for QA to release them."""

    machines: list[MachineStatus]
    running: int
    stopped: int
    awaiting_release: int
    unassigned: int = Field(description="Open guides that name no machine.")
    as_of: datetime = Field(default_factory=_now)
