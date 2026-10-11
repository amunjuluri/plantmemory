"""Upload an equipment manual (PDF): Gemini reads it page by page, figures are cut out of
the rendered pages, and the sections become searchable and citable by page.

The model returns text, alarm codes and figure boxes; code renders the pages with
pdfium and crops each figure, so every picture in a guide is the manual's own drawing.
"""

import io
import logging
import re

from google.genai import types

from app.agent import prompts
from app.agent.tools import AgentDeps
from app.kb import KnowledgeBase
from app.kb.loader import (
    build_manual,
    figure_from_file,
    manual_code,
    section_text,
    summarize_manuals,
)
from app.models import Figure, ManualExtraction, ManualSectionPublic, ManualUploadResult

log = logging.getLogger(__name__)

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PAGES = 40
READ_TIMEOUT_MS = 240_000
RENDER_SCALE = 2.0  # about 144 dpi
MAX_FIGURE_EDGE = 1024
MIN_BOX_SHARE = 0.02  # ignore boxes smaller than 2% of the page (icons, logos)


class InvalidManualError(ValueError):
    """The upload is not a usable PDF manual."""


def check_pdf(data: bytes) -> int:
    """Raise unless `data` is a PDF within limits; return its page count."""
    if len(data) > MAX_PDF_BYTES:
        raise InvalidManualError("The PDF is larger than 20 MB.")
    if not data.startswith(b"%PDF-"):
        raise InvalidManualError("Upload the manual as a PDF file.")
    import pypdfium2 as pdfium

    try:
        pages = len(pdfium.PdfDocument(data))
    except pdfium.PdfiumError as err:
        raise InvalidManualError("That PDF could not be opened.") from err
    if pages > MAX_PAGES:
        raise InvalidManualError(
            f"This demo reads manuals of up to {MAX_PAGES} pages; upload the troubleshooting "
            "chapter on its own."
        )
    return pages


def parse_tags(text: str | None) -> list[str]:
    """'TP-01, tp-02' -> ['TP-01', 'TP-02']."""
    return list(
        dict.fromkeys(t.strip().upper() for t in re.split(r"[,;\s]+", text or "") if t.strip())
    )


def crop_figures(
    data: bytes, extraction: ManualExtraction, manual_id: str
) -> tuple[list[Figure], dict[int, list[str]]]:
    """Render each page that has figures and cut them out. Bad boxes are skipped."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    figures: list[Figure] = []
    by_page: dict[int, list[str]] = {}
    for section in extraction.sections:
        if not section.figures or not 1 <= section.page <= len(pdf):
            continue
        page_image = pdf[section.page - 1].render(scale=RENDER_SCALE).to_pil().convert("RGB")
        width, height = page_image.size
        for box in section.figures:
            if len(box.box_2d) != 4:
                continue
            ymin, xmin, ymax, xmax = (max(0, min(1000, v)) for v in box.box_2d)
            if ymax <= ymin or xmax <= xmin:
                continue
            if (ymax - ymin) * (xmax - xmin) < MIN_BOX_SHARE * 1_000_000:
                continue
            pad = 10  # 1% of the page on each side
            crop = page_image.crop(
                (
                    max(0, (xmin - pad)) * width // 1000,
                    max(0, (ymin - pad)) * height // 1000,
                    min(1000, (xmax + pad)) * width // 1000,
                    min(1000, (ymax + pad)) * height // 1000,
                )
            )
            crop.thumbnail((MAX_FIGURE_EDGE, MAX_FIGURE_EDGE))
            buffer = io.BytesIO()
            crop.save(buffer, "JPEG", quality=85, optimize=True)
            n = len(by_page.get(section.page, [])) + 1
            figure_id = f"FIG-{manual_id}-P{section.page}-{n}"
            figures.append(
                figure_from_file(
                    {
                        "id": figure_id,
                        "caption": box.caption,
                        "source": "manual",
                        "manual_id": manual_id,
                        "page": section.page,
                    },
                    buffer.getvalue(),
                    "image/jpeg",
                )
            )
            by_page.setdefault(section.page, []).append(figure_id)
    return figures, by_page


def _free_manual_id(code: str, equipment_model: str, kb: KnowledgeBase) -> str:
    """The manual's code, or code-2, code-3... if another model already uses it."""
    candidate, n = code, 1
    while True:
        existing = kb.sections.all(manual_id=candidate)
        if not existing or existing[0].equipment_model == equipment_model:
            return candidate
        n += 1
        candidate = f"{code}{n}"


def delete_manual(manual_id: str, kb: KnowledgeBase) -> int:
    """Remove a manual's sections, codes and figures. Returns sections removed."""
    sections = kb.sections.all(manual_id=manual_id)
    figure_ids = {f for s in sections for f in s.figure_ids}
    kb.sections.delete([s.id for s in sections])
    kb.codes.delete([c.id for c in kb.codes.all(manual_id=manual_id)])
    kb.figures.delete(figure_ids)
    return len(sections)


def ingest_manual(
    data: bytes,
    filename: str | None,
    asset_tags: list[str],
    deps: AgentDeps,
    kb: KnowledgeBase,
) -> ManualUploadResult:
    """Read, cut figures from, embed and store a manual. Re-uploading replaces it."""
    check_pdf(data)
    pdf = types.Part.from_bytes(data=data, mime_type="application/pdf")
    extraction = deps.llm.generate(
        [pdf, prompts.MANUAL_PROMPT], ManualExtraction, thinking="low", timeout_ms=READ_TIMEOUT_MS
    )
    if not extraction.sections:
        raise InvalidManualError("No usable sections were found in that PDF.")

    manual_id = _free_manual_id(
        manual_code(extraction.equipment_model or filename or "manual"),
        extraction.equipment_model,
        kb,
    )
    try:
        figures, by_page = crop_figures(data, extraction, manual_id)
    except Exception:  # figures are a bonus; the text is what matters
        log.exception("Cutting figures out of %s failed", filename)
        figures, by_page = [], {}

    sections, codes = build_manual(
        manual_id,
        extraction.title or (filename or "Manual"),
        extraction.equipment_model,
        asset_tags,
        extraction.sections,
        extraction.error_codes,
        figure_ids_by_page=by_page,
    )
    vectors = deps.embedder.embed_documents([section_text(s) for s in sections])
    for section, vector in zip(sections, vectors, strict=True):
        section.embedding = vector

    delete_manual(manual_id, kb)
    kb.figures.put(figures)
    kb.sections.put(sections)
    kb.codes.put(codes)

    summary = next(m for m in summarize_manuals(kb) if m.manual_id == manual_id)
    return ManualUploadResult(
        summary=summary,
        sections=[
            ManualSectionPublic.model_validate(s.model_dump(exclude={"embedding"}))
            for s in sections
        ],
    )
