"""Load the stand-in manuals, alarm codes, spare parts and figures into the knowledge base.

Usage: uv run python -m scripts.seed_kb [--reset]

--reset deletes manuals, codes, parts and figures first. Repair guides are never touched.
"""

import argparse
import json

from app.config import ROOT_DIR, get_settings
from app.embeddings import GeminiEmbedder
from app.kb import get_kb
from app.kb.loader import build_manual, figure_from_file, section_text
from app.models import Part

KB_DIR = ROOT_DIR / "data" / "kb"


def load_figures():
    figures = []
    for meta in json.loads((KB_DIR / "figures.json").read_text()):
        for ext, mime in (("png", "image/png"), ("jpg", "image/jpeg")):
            path = KB_DIR / "figures" / f"{meta['id']}.{ext}"
            if path.exists():
                figures.append(figure_from_file(meta, path.read_bytes(), mime))
                break
        else:
            print(f"  no image file for {meta['id']} (run scripts.make_figures)")
    return figures


def load_manuals():
    sections, codes = [], []
    for path in sorted((KB_DIR / "manuals").glob("*.json")):
        manual = json.loads(path.read_text())
        built, error_codes = build_manual(
            manual["manual_id"],
            manual["manual_title"],
            manual["equipment_model"],
            manual["asset_tags"],
            manual["sections"],
            manual["error_codes"],
        )
        sections.extend(built)
        codes.extend(error_codes)
    return sections, codes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete existing KB data first")
    args = parser.parse_args()

    settings = get_settings()
    kb = get_kb()
    figures = load_figures()
    known_figures = {f.id for f in figures}
    sections, codes = load_manuals()
    for section in sections:
        section.figure_ids = [f for f in section.figure_ids if f in known_figures]
    parts = [Part.model_validate(p) for p in json.loads((KB_DIR / "parts.json").read_text())]
    for part in parts:
        if part.figure_id not in known_figures:
            part.figure_id = None

    vectors = GeminiEmbedder(settings).embed_documents([section_text(s) for s in sections])
    for section, vector in zip(sections, vectors, strict=True):
        section.embedding = vector

    if args.reset:
        for store in (kb.sections, kb.codes, kb.parts, kb.figures):
            store.clear()
    kb.figures.put(figures)
    kb.sections.put(sections)
    kb.codes.put(codes)
    kb.parts.put(parts)
    print(
        f"Loaded {len(sections)} manual sections, {len(codes)} alarm codes, {len(parts)} parts "
        f"and {len(figures)} figures into the '{settings.store_backend}' knowledge base."
    )


if __name__ == "__main__":
    main()
