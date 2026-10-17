"""Draw the architecture diagram: docs/architecture.svg, and docs/architecture.png for the
deck (rendered in headless Chrome when Playwright is available).

    uv run python -m scripts.make_architecture
    uv run --with playwright python -m scripts.make_architecture --png
"""

import argparse
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs"
W, H = 1600, 1000
FONT = "Inter, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
MONO = "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace"

INK, MUTED, SUBTLE, LINE = "#14171c", "#566070", "#8a93a0", "#dfe3e8"
BLUE, BLUE_SOFT = "#1d5bd6", "#eaf0fd"
VIOLET, VIOLET_SOFT = "#6b46d9", "#f1edfd"
AMBER, AMBER_SOFT = "#b45f06", "#fdf4e6"
GREEN, GREEN_SOFT = "#17794a", "#e7f5ed"
PANEL = "#f6f7f9"

parts: list[str] = []


def text(x, y, s, size=14, weight=400, fill=INK, anchor="start", family=FONT, spacing=0):
    parts.append(
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}" letter-spacing="{spacing}">{escape(s)}</text>'
    )


def lines(x, y, rows, size=13, fill=MUTED, gap=18, weight=400):
    for i, row in enumerate(rows):
        text(x, y + i * gap, row, size=size, fill=fill, weight=weight)


def box(x, y, w, h, fill="#fff", stroke=LINE, r=14, width=1, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{width}"{d}/>'
    )


def label(x, y, s, color):
    """A small uppercase section label."""
    text(x, y, s.upper(), size=11, weight=650, fill=color, spacing=0.8)


def arrow(points, color=SUBTLE, width=1.6, dash=None, head=True):
    path = " ".join(f"{'M' if i == 0 else 'L'} {x} {y}" for i, (x, y) in enumerate(points))
    d = f' stroke-dasharray="{dash}"' if dash else ""
    end = ' marker-end="url(#head)"' if head else ""
    parts.append(
        f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{width}" '
        f'stroke-linecap="round" stroke-linejoin="round"{d}{end}/>'
    )


def step(x, y, w, h, title, sub, color=BLUE, fill="#fff"):
    box(x, y, w, h, fill=fill, stroke=LINE, r=10)
    parts.append(
        f'<rect x="{x}" y="{y + 10}" width="3" height="{h - 20}" rx="1.5" fill="{color}"/>'
    )
    text(x + 14, y + 22, title, size=13, weight=600)
    lines(x + 14, y + 40, sub, size=11.5, gap=15)


def draw() -> str:
    parts.clear()
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
        '<defs><marker id="head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" '
        'markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" '
        f'fill="{SUBTLE}"/></marker></defs>'
    )
    box(0, 0, W, H, fill="#ffffff", stroke="none", r=0)

    # Title
    text(40, 52, "PlantMemory architecture", size=26, weight=700)
    text(
        40,
        80,
        "One Cloud Run service, managed serverless data, Gemini on Vertex AI. "
        "Gemini reads and writes; code checks every line before anyone sees it.",
        size=14.5,
        fill=MUTED,
    )

    # --- Left: the manager's inputs, and the printed sheet
    box(40, 120, 250, 470, fill=PANEL, stroke="none")
    label(60, 148, "Manager, phone or desktop", MUTED)
    inputs = [
        ("Typed report", "any language, short forms"),
        ("Voice conversation", "Telugu, Hindi, English, mixed"),
        ("Logbook photo", "handwritten pages"),
        ("Machine alarm log", "HMI or controller export"),
        ("SAP PM / CMMS export", "CSV or Excel"),
        ("Equipment manual", "PDF"),
    ]
    for i, (name, sub) in enumerate(inputs):
        y = 166 + i * 68
        box(56, y, 218, 56, fill="#fff", stroke=LINE, r=10)
        text(70, y + 23, name, size=13, weight=600)
        text(70, y + 41, sub, size=11.5, fill=MUTED)

    box(40, 610, 250, 150, fill=GREEN_SOFT, stroke="none")
    label(60, 638, "Workers on the floor", GREEN)
    text(60, 666, "Printed A4 repair sheet", size=14, weight=600)
    lines(
        60,
        688,
        [
            "English plus up to 3 of 12",
            "Indian languages, numbered",
            "controlled copies, tick boxes",
        ],
        size=12,
    )

    # --- Centre: Cloud Run
    cx, cy, cw, ch = 330, 120, 790, 640
    box(cx, cy, cw, ch, fill=BLUE_SOFT, stroke="none", r=16)
    label(cx + 22, cy + 28, "Cloud Run · asia-south1", BLUE)
    text(
        cx + 22,
        cy + 52,
        "FastAPI + Next.js UI + voice WebSocket in one container · 1 to 3 instances, 1 kept warm",
        size=13,
        fill=MUTED,
    )

    # Intake row
    iy = cy + 72
    label(cx + 22, iy + 4, "Intake", MUTED)
    intake = [
        ("Live voice", ["Gemini Live asks only", "for what's missing"]),
        ("Logbook OCR", ["unreadable words", "flagged, never guessed"]),
        ("Alarm log", ["stopping codes first,", "one click to a guide"]),
        ("SAP import", ["Gemini maps columns,", "code copies every row"]),
        ("Manual ingest", ["sections, alarm table,", "figures cut out"]),
    ]
    for i, (t, sub) in enumerate(intake):
        step(cx + 22 + i * 151, iy + 16, 140, 74, t, sub, color=VIOLET)

    # Guide pipeline row
    py = iy + 118
    label(cx + 22, py + 4, "Repair guide · ADK graph Workflow · streamed, about 10 s", BLUE)
    by = py + 16
    step(
        cx + 22,
        by,
        150,
        92,
        "Read the report",
        ["structure + check, side", "by side; wrong machine", "or vague → one question"],
    )
    step(cx + 214, by - 6, 170, 48, "Past fixes", ["vector search, Gemini verifies"], color=AMBER)
    step(cx + 214, by + 50, 170, 48, "Manual", ["alarm section + vector search"], color=AMBER)
    step(
        cx + 426,
        by,
        140,
        92,
        "Parts and time",
        ["stock and bin from", "the store; downtime", "from past repairs"],
    )
    step(
        cx + 608,
        by,
        160,
        92,
        "Write the guide",
        ["structured JSON,", "every line cited"],
        color=VIOLET,
    )
    arrow([(cx + 172, by + 46), (cx + 193, by + 46), (cx + 193, by + 18), (cx + 212, by + 18)])
    arrow([(cx + 193, by + 46), (cx + 193, by + 74), (cx + 212, by + 74)], head=True)
    arrow([(cx + 384, by + 18), (cx + 405, by + 18), (cx + 405, by + 46), (cx + 424, by + 46)])
    arrow([(cx + 384, by + 74), (cx + 405, by + 74), (cx + 405, by + 46)], head=False)
    arrow([(cx + 566, by + 46), (cx + 606, by + 46)])
    text(cx + 296, by + 112, "run side by side", size=11, fill=SUBTLE, anchor="middle")

    # Guardrails
    gy = by + 128
    box(cx + 22, gy, cw - 44, 104, fill=GREEN_SOFT, stroke="none", r=12)
    label(cx + 40, gy + 26, "Code checks, not the model", GREEN)
    checks = [
        "A step may cite only the sources it was given",
        "Every torque, temperature or time must appear in its source",
        "Parts must exist in the store; short stock is flagged",
        "Translations must keep every number, code and tag",
        "Anything unchecked goes to QA, with the reason",
        "Wrong machine or vague report: one question, no guess",
    ]
    for i, c in enumerate(checks):
        col, row = divmod(i, 3)
        x = cx + 40 + col * 370
        y = gy + 52 + row * 19
        parts.append(f'<circle cx="{x + 4}" cy="{y - 4}" r="3" fill="{GREEN}"/>')
        text(x + 14, y, c, size=12.5, fill=INK)

    # Workflow row
    wy = gy + 130
    label(cx + 22, wy + 4, "Guide workflow · audit trail on every step", MUTED)
    flow = [
        "Approve",
        "QA if needed",
        "Translate + check",
        "Print copy",
        "Close repair",
        "QA release",
    ]
    fw = 112
    for i, name in enumerate(flow):
        x = cx + 22 + i * (fw + 15)
        box(x, wy + 16, fw, 40, fill="#fff", stroke=LINE, r=20)
        text(x + fw / 2, wy + 41, name, size=12.5, weight=600, anchor="middle")
        if i:
            arrow([(x - 14, wy + 36), (x - 2, wy + 36)])

    # Inputs → Cloud Run, Cloud Run → printed sheet
    arrow([(290, 330), (cx - 4, 330)], color=BLUE, width=2)
    pw = cx + 22 + 3 * (fw + 15) + fw / 2
    arrow([(pw, wy + 58), (pw, 790), (165, 790), (165, 764)], color=GREEN, width=1.8)

    # --- Right: Vertex AI and Firestore
    rx, rw = 1160, 400
    box(rx, 120, rw, 300, fill=VIOLET_SOFT, stroke="none", r=16)
    label(rx + 22, 148, "Vertex AI · Gemini", VIOLET)
    models = [
        ("gemini-3.1-flash-lite", "reads, checks, writes, translates; hedged after a slow reply"),
        ("gemini-3.5-flash-lite", "takes over when the first is out of capacity"),
        ("gemini-embedding-2", "768-d search by meaning, across languages"),
        ("gemini-3.8-live", "voice conversation, native audio, us-central1"),
        ("Agent Development Kit", "runs the guide graph; analysis agent with 4 tools"),
    ]
    for i, (m, sub) in enumerate(models):
        y = 172 + i * 49
        box(rx + 18, y, rw - 36, 42, fill="#fff", stroke="none", r=9)
        text(rx + 32, y + 18, m, size=12.5, weight=600, family=MONO)
        text(rx + 32, y + 34, sub, size=11.5, fill=MUTED)

    box(rx, 440, rw, 320, fill=AMBER_SOFT, stroke="none", r=16)
    label(rx + 22, 468, "Firestore · asia-south1", AMBER)
    text(rx + 22, 492, "Native vector search (KNN, cosine)", size=13, weight=600)
    for i, (n, sub) in enumerate(
        [("incidents", "plant memory: past repairs"), ("manual_sections", "procedures and alarms")]
    ):
        y = 504 + i * 46
        box(rx + 18, y, rw - 36, 40, fill="#fff", stroke="none", r=9)
        text(rx + 32, y + 25, n, size=12.5, weight=600, family=MONO)
        text(rx + 190, y + 25, sub, size=12, fill=MUTED)
    text(rx + 22, 620, "Documents", size=13, weight=600)
    docs = ["guides + audit trail", "parts and stock", "alarm codes", "figures", "plant settings"]
    x, y = rx + 18, 634
    for d in docs:
        w = 16 + len(d) * 7.1
        if x + w > rx + rw - 18:
            x, y = rx + 18, y + 38
        box(x, y, w, 30, fill="#fff", stroke="none", r=15)
        text(x + w / 2, y + 20, d, size=12, anchor="middle", family=MONO)
        x += w + 8

    arrow([(cx + cw + 4, 270), (rx - 6, 270)], color=VIOLET, width=2)
    arrow([(rx - 6, 290), (cx + cw + 4, 290)], color=VIOLET, width=2)
    arrow([(cx + cw + 4, 600), (rx - 6, 600)], color=AMBER, width=2)
    arrow([(rx - 6, 620), (cx + cw + 4, 620)], color=AMBER, width=2)
    # A closed repair becomes plant memory.
    ex = cx + 22 + 4 * (fw + 15) + fw / 2
    arrow(
        [(ex, wy + 58), (ex, 790), (1360, 790), (1360, 764)],
        color=AMBER,
        width=1.6,
        dash="5 5",
    )
    text(1150, 808, "a closed repair becomes plant memory", size=12, fill=AMBER, anchor="middle")

    # --- Bottom: delivery and operations
    box(40, 830, 760, 130, fill=PANEL, stroke="none")
    label(60, 858, "Delivery", MUTED)
    chain = ["GitHub Actions", "Workload Identity", "Cloud Build", "Artifact Registry", "Cloud Run"]
    x = 60
    for i, c in enumerate(chain):
        w = 16 + len(c) * 7.4
        box(x, 876, w, 34, fill="#fff", stroke=LINE, r=17)
        text(x + w / 2, 898, c, size=12.5, weight=600, anchor="middle")
        if i < len(chain) - 1:
            arrow([(x + w + 4, 893), (x + w + 18, 893)])
        x += w + 22
    text(
        60,
        936,
        "Every pull request is checked; main deploys itself. No service account keys.",
        size=12,
        fill=MUTED,
    )

    box(820, 830, 740, 130, fill=PANEL, stroke="none")
    label(840, 858, "Operations", MUTED)
    ops = ["Cloud Logging", "Error Reporting", "Firebase Analytics", "per-client AI rate limit"]
    x = 840
    for c in ops:
        w = 16 + len(c) * 7.4
        box(x, 876, w, 34, fill="#fff", stroke=LINE, r=17)
        text(x + w / 2, 898, c, size=12.5, weight=600, anchor="middle")
        x += w + 10
    text(
        840,
        936,
        "JSON logs per action; browser errors grouped with stack traces; never what anyone said.",
        size=12,
        fill=MUTED,
    )

    parts.append("</svg>")
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--png", action="store_true", help="also render docs/architecture.png")
    args = parser.parse_args()
    svg = draw()
    (OUT / "architecture.svg").write_text(svg)
    print(f"wrote {OUT / 'architecture.svg'}")
    if args.png:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=2)
            page.set_content(f"<body style='margin:0'>{svg}</body>")
            page.screenshot(path=str(OUT / "architecture.png"))
            browser.close()
        print(f"wrote {OUT / 'architecture.png'}")


if __name__ == "__main__":
    main()
