"""Generate the synthetic manual figures and part photos listed in data/kb/figures.json.

Each image is drawn by Gemini's image model from an invented description, so no real
manual or photo is copied. Existing files are kept; delete one to redraw it.

Usage: uv run python -m scripts.make_figures [--model gemini-3.1-flash-image]
"""

import argparse
import io
import json
from concurrent.futures import ThreadPoolExecutor

from google.genai import types
from PIL import Image

from app.config import ROOT_DIR
from app.llm import get_genai_client

KB_DIR = ROOT_DIR / "data" / "kb"
FIGURE_DIR = KB_DIR / "figures"
MAX_EDGE = 1024  # keeps each image well under Firestore's 1 MiB document limit


def figure_path(figure: dict):
    ext = "jpg" if figure["source"] == "part" else "png"
    return FIGURE_DIR / f"{figure['id']}.{ext}"


def draw(figure: dict, model: str) -> str:
    path = figure_path(figure)
    if path.exists():
        return f"kept  {path.name}"
    try:
        response = get_genai_client().models.generate_content(
            model=model,
            contents=figure["prompt"],
            config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
        )
    except Exception as err:  # keep going; re-run later to fill the gaps
        return f"FAILED {figure['id']}: {err}"
    parts = [p for p in response.candidates[0].content.parts if p.inline_data]
    if not parts:
        return f"FAILED {figure['id']}: no image returned"
    image = Image.open(io.BytesIO(parts[0].inline_data.data))
    image.thumbnail((MAX_EDGE, MAX_EDGE))
    if path.suffix == ".jpg":
        image.convert("RGB").save(path, "JPEG", quality=84, optimize=True)
    else:
        # Line drawings: greyscale PNG compresses small and prints crisply.
        image.convert("L").save(path, "PNG", optimize=True)
    return f"drew  {path.name} ({path.stat().st_size // 1024} KB)"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="gemini-3.1-flash-image")
    args = parser.parse_args()
    FIGURE_DIR.mkdir(parents=True, exist_ok=True)
    figures = json.loads((KB_DIR / "figures.json").read_text())
    with ThreadPoolExecutor(max_workers=1) as pool:
        for line in pool.map(lambda f: draw(f, args.model), figures):
            print(line, flush=True)


if __name__ == "__main__":
    main()
