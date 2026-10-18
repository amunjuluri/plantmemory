"""Write docs/BENCHMARK.md and its charts from the JSON that scripts/benchmark.py saves.

Run with `uv run python -m scripts.benchmark report`. Any part not yet run is skipped.
"""

import json
import statistics

from scripts.benchmark import OUT_DIR, PRICE, ROOT_DIR, USD_TO_INR, pct, summary

DOC = ROOT_DIR / "docs" / "BENCHMARK.md"

# Reference categorical palette (dataviz skill, light mode), validated adjacent-pair safe.
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
GRAY = "#a3a29c"
INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e7e6e1", "#fcfcfb"
STEP_NAMES = {
    "understand": "Understand the report",
    "search_history": "Search plant memory + Gemini check",
    "search_manuals": "Search equipment manuals",
    "find_parts": "Parts and stock",
    "write_guide": "Write guide + code checks",
}


def _load(name: str) -> dict | None:
    path = OUT_DIR / f"{name}.json"
    return json.loads(path.read_text()) if path.exists() else None


def s(x: float | None, digits: int = 1) -> str:
    return "n/a" if x is None else f"{x:.{digits}f}"


def ms(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 1000:.0f} ms"


def rate(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.0f}%)" if d else "n/a"


# --- charts ---


def _style():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": ["Helvetica Neue", "Arial", "DejaVu Sans"],
            "font.size": 11,
            "axes.edgecolor": GRID,
            "axes.labelcolor": INK_2,
            "axes.titlecolor": INK,
            "axes.titlesize": 13,
            "axes.titleweight": "bold",
            "axes.titlelocation": "left",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "axes.axisbelow": True,
            "grid.color": GRID,
            "grid.linewidth": 0.8,
            "xtick.color": INK_2,
            "ytick.color": INK_2,
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "savefig.facecolor": SURFACE,
            "savefig.dpi": 200,
        }
    )
    return plt


def chart_waterfall(local: dict) -> str | None:
    """Where the time goes: median start and length of each step, parallel steps visible."""
    runs = [r for r in local["runs"] if not r["error"] and r["steps"]]
    if not runs:
        return None
    plt = _style()
    med = {k: statistics.median(r["steps"].get(k, 0) for r in runs) for k in STEP_NAMES}
    # Steps run in this order; the two searches start together.
    starts = {"understand": 0.0}
    starts["search_history"] = starts["search_manuals"] = med["understand"]
    after = starts["search_history"] + max(med["search_history"], med["search_manuals"])
    starts["find_parts"] = after
    starts["write_guide"] = after + med["find_parts"]
    total = statistics.median(r["total"] for r in runs)

    fig, ax = plt.subplots(figsize=(10, 3.6))
    labels = list(STEP_NAMES.values())[::-1]
    keys = list(STEP_NAMES)[::-1]
    for i, k in enumerate(keys):
        ax.barh(i, max(med[k], 0.08), left=starts[k], height=0.55, color=BLUE)
        ax.text(
            starts[k] + max(med[k], 0.08) + 0.2,
            i,
            f"{med[k]:.1f} s" if med[k] >= 0.1 else "<0.1 s",
            va="center",
            color=INK,
            fontsize=10,
        )
    ax.set_yticks(range(len(keys)), labels)
    ax.set_xlabel("seconds from the manager pressing Draft (median of all runs)")
    ax.set_title(f"Where the {total:.0f} s go: one cited repair guide, step by step")
    ax.grid(axis="y", visible=False)
    ax.set_xlim(0, total * 1.12)
    fig.tight_layout()
    path = OUT_DIR / "latency_steps.png"
    fig.savefig(path)
    plt.close(fig)
    return path.name


def chart_cases(remote: dict | None, local: dict) -> str | None:
    """Total time per breakdown report, every run as a dot, median as a tick."""
    source = "Cloud Run (as a user sees it)" if remote else "in process"
    rows = (remote or {}).get("sequential") or [
        {"case": r["case"], "total": r["total"]} for r in local["runs"] if not r["error"]
    ]
    rows = [r for r in rows if r.get("total")]
    if not rows:
        return None
    plt = _style()
    labels = {c["id"]: c["label"] for c in local["cases"]}
    cases = list(dict.fromkeys(r["case"] for r in rows))
    fig, ax = plt.subplots(figsize=(10, 4.2))
    for i, c in enumerate(cases[::-1]):
        times = [r["total"] for r in rows if r["case"] == c]
        ax.scatter(times, [i] * len(times), s=36, color=BLUE, zorder=3, edgecolor=SURFACE, lw=1.5)
        m = statistics.median(times)
        ax.plot([m, m], [i - 0.3, i + 0.3], color=INK, lw=2, zorder=4)
    ax.set_yticks(range(len(cases)), [labels.get(c, c) for c in cases[::-1]])
    ax.set_xlabel("seconds to a finished, checked guide (dots: runs; bar: median)")
    ax.set_title(f"Time to a repair guide, by kind of report ({source})")
    ax.grid(axis="y", visible=False)
    ax.set_xlim(0, max(r["total"] for r in rows) * 1.1)
    fig.tight_layout()
    path = OUT_DIR / "latency_cases.png"
    fig.savefig(path)
    plt.close(fig)
    return path.name


def chart_plain(local: dict) -> str | None:
    """Plain Gemini vs PlantMemory on the two things a technician acts on: parts and values."""
    plain = local.get("plain") or []
    runs = [r for r in local["runs"] if r.get("checks") and r["rep"] == 0]
    if not plain or not runs:
        return None
    plt = _style()
    p_parts = sum(p["parts_real"] for p in plain), sum(p["parts"] for p in plain)
    p_vals = sum(p["values_in_plant_docs"] for p in plain), sum(p["values"] for p in plain)
    c = [r["checks"] for r in runs]
    m_parts = sum(x["parts"] for x in c), sum(x["parts"] for x in c)
    m_vals = sum(x["values"] - x["values_flagged"] for x in c), sum(x["values"] for x in c)

    def share(t):
        return 100 * t[0] / t[1] if t[1] else 0

    groups = [
        "Spare part numbers that\nexist in the plant store",
        "Values (Nm, °C, bar, mm…)\nbacked by a plant source",
    ]
    plain_v = [share(p_parts), share(p_vals)]
    ours_v = [share(m_parts), share(m_vals)]
    fig, ax = plt.subplots(figsize=(10, 3.8))
    y = [1, 0]
    h = 0.3
    for yy, pv, ov, pt, mt in zip(
        y, plain_v, ours_v, [p_parts, p_vals], [m_parts, m_vals], strict=True
    ):
        ax.barh(yy + h / 2 + 0.01, pv, height=h, color=GRAY)
        ax.barh(yy - h / 2 - 0.01, ov, height=h, color=BLUE)
        ax.text(
            pv + 1, yy + h / 2, f"{pv:.0f}%  ({pt[0]}/{pt[1]})", va="center", fontsize=10, color=INK
        )
        ax.text(
            ov + 1, yy - h / 2, f"{ov:.0f}%  ({mt[0]}/{mt[1]})", va="center", fontsize=10, color=INK
        )
    ax.set_yticks(y, groups)
    ax.set_xlim(0, 118)
    ax.set_xticks([0, 25, 50, 75, 100], ["0%", "25%", "50%", "75%", "100%"])
    ax.grid(axis="y", visible=False)
    from matplotlib.patches import Patch

    ax.legend(
        handles=[
            Patch(color=GRAY, label="Gemini alone (same model)"),
            Patch(color=BLUE, label="PlantMemory"),
        ],
        loc="lower left",
        bbox_to_anchor=(0, 1.0),
        ncol=2,
        frameon=False,
    )
    ax.set_title("Same breakdowns, same model: what reaches the technician", pad=30)
    fig.tight_layout()
    path = OUT_DIR / "plain_vs_plantmemory.png"
    fig.savefig(path)
    plt.close(fig)
    return path.name


def chart_load(remote: dict | None) -> str | None:
    rows = (remote or {}).get("concurrent") or []
    rows = [r for r in rows if r["latency"].get("n")]
    if len(rows) < 2:
        return None
    plt = _style()
    fig, ax = plt.subplots(figsize=(10, 3.6))
    x = [r["concurrent"] for r in rows]
    for key, color, label in (("p50", BLUE, "median"), ("p95", ORANGE, "95th percentile")):
        y = [r["latency"][key] for r in rows]
        ax.plot(x, y, color=color, lw=2, marker="o", ms=8, label=label, mec=SURFACE, mew=2)
        ax.text(x[-1] + 0.15, y[-1], f"{label} {y[-1]:.0f} s", va="center", color=INK, fontsize=10)
    ax.set_xticks(x, [f"{n} at once" for n in x])
    ax.set_ylim(0, max(r["latency"]["p95"] for r in rows) * 1.25)
    ax.set_xlim(min(x) - 0.5, max(x) + 2.2)
    ax.set_ylabel("seconds to a guide")
    ax.legend(frameon=False, loc="upper left")
    ax.set_title("Managers drafting at the same time (Cloud Run, autoscaling)")
    fig.tight_layout()
    path = OUT_DIR / "load.png"
    fig.savefig(path)
    plt.close(fig)
    return path.name


# --- markdown ---


def _calls_by_schema(runs: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    n = len(runs)
    for r in runs:
        for c in r["calls"]:
            row = out.setdefault(
                c["schema"], {"calls": 0, "input": 0, "output": 0, "thinking": 0, "seconds": []}
            )
            row["calls"] += 1
            row["input"] += c["input"]
            row["output"] += c.get("output", 0)
            row["thinking"] += c.get("thinking", 0)
            row["seconds"].append(c["seconds"])
    for row in out.values():
        for k in ("calls", "input", "output", "thinking"):
            row[k] = row[k] / n
    return out


CALL_NAMES = {
    "StructuredIncident": "Understand the report",
    "MatchCheck": "Check memory matches",
    "GuideContent": "Write the guide",
    "embedding": "Embeddings (search)",
    "TranslationOut": "Translate (per language)",
    "ManualPick": "Check the manual's equipment (untagged reports only)",
}


def write_report() -> None:
    local, guard, remote = _load("local"), _load("guardrails"), _load("remote")
    lighthouse = _load("lighthouse")
    if not local:
        raise SystemExit("Run `scripts.benchmark local` first.")
    charts = {
        "steps": chart_waterfall(local),
        "cases": chart_cases(remote, local),
        "plain": chart_plain(local),
        "load": chart_load(remote),
    }
    L: list[str] = []
    env = local["env"]
    runs = [r for r in local["runs"] if not r["error"]]
    failed = [r for r in local["runs"] if r["error"]]
    checks = [r["checks"] for r in runs if r.get("checks")]
    totals = [r["total"] for r in runs]
    costs = [r["cost_usd"] for r in runs]
    tr = local["translations"]
    tr_cost = statistics.fmean(t["cost_usd"] for t in tr) if tr else 0.0
    guide_cost = statistics.fmean(costs) if costs else 0.0

    L += [
        "# Prototype performance and benchmarks",
        "",
        f"Generated by `scripts/benchmark.py` on {env['at'][:10]} (code at `{env['commit']}`). "
        f"Models: `{env['gemini_model']}` (thinking `{env['thinking']}`), "
        f"`{env['embedding_model']}`, `{env['live_model']}`. Past incidents are real public "
        "records; manuals, parts and test reports are synthetic (see data/SOURCES.md). "
        f"Raw results are in [docs/benchmark/](benchmark/); re-run with the commands at the end.",
        "",
        "## Headline numbers",
        "",
        "| What | Result |",
        "|---|---|",
    ]
    if remote and remote.get("sequential"):
        seq = [r for r in remote["sequential"] if r["total"]]
        first = [r["first_event"] for r in remote["sequential"] if r["first_event"] is not None]
        L.append(
            f"| Breakdown report to a cited, checked repair guide (Cloud Run, median / p95) | "
            f"**{s(pct([r['total'] for r in seq], 50))} s** / {s(pct([r['total'] for r in seq], 95))} s "
            f"(n={len(seq)}, {len(remote['sequential']) - len(seq)} failed) |"
        )
        L.append(
            f"| First visible progress after pressing Draft (median) | {s(pct(first, 50), 2)} s |"
        )
    L.append(
        f"| Same, in process (median / p95) | {s(pct(totals, 50))} s / {s(pct(totals, 95))} s "
        f"(n={len(totals)}, {len(failed)} failed) |"
    )
    if remote and remote.get("voice"):
        spoken = [
            v["first_audio"]
            for v in remote["voice"]
            if v.get("first_audio") and v["mode"] == "audio"
        ]
        if spoken:
            L.append(
                f"| Voice: end of the manager's speech to the spoken reply (Gemini Live, median) | "
                f"{s(pct(spoken, 50), 1)} s, including Gemini detecting the end of speech (n={len(spoken)}) |"
            )
    L.append(
        f"| Gemini cost per guide (standard price) | ${guide_cost:.4f} (₹{guide_cost * USD_TO_INR:.2f}); "
        f"translation into Telugu + Hindi ${tr_cost:.4f} |"
    )
    if checks:
        cited = sum(c["steps_cited"] for c in checks), sum(c["steps"] for c in checks)
        L.append(f"| Repair steps that cite a manual page or a past fix | {rate(*cited)} |")
        ok = sum(c["asset_ok"] and c["codes_ok"] and c["manual_ok"] for c in checks)
        L.append(f"| Right machine, alarm and manual found | {rate(ok, len(checks))} |")
    if local.get("plain"):
        p = local["plain"]
        L.append(
            f"| Gemini alone: part numbers that exist in the store | "
            f"{rate(sum(x['parts_real'] for x in p), sum(x['parts'] for x in p))} "
            f"(PlantMemory: only store parts, by code) |"
        )
    if guard:
        bk = guard["by_kind"]
        L.append(
            f"| Planted faults caught by the code checks | "
            f"{rate(sum(v['caught'] for v in bk.values()), sum(v['planted'] for v in bk.values()))} |"
        )
    routing = local.get("manual_routing") or []
    if routing:
        none = [r for r in routing if r["expected"] is None]
        L.append(
            f"| Unknown equipment given another machine's manual (score only → with Gemini check) | "
            f"{sum(r['by_score'] is not None for r in none)}/{len(none)} → "
            f"**{sum(r['checked'] is not None for r in none)}/{len(none)}** |"
        )
    if lighthouse:
        m = lighthouse["after"]["mobile"]["scores"]
        L.append(
            f"| Lighthouse on a phone: performance / accessibility | {m['performance']} / {m['accessibility']} "
            f"(was {lighthouse['before']['mobile']['scores']['performance']} / "
            f"{lighthouse['before']['mobile']['scores']['accessibility']}) |"
        )
    L += [
        "| Recognising a repeat failure (from [EVAL_RESULTS.md](EVAL_RESULTS.md)) | "
        "30/30 right; 0/16 false alarms (0/13 on look-alikes) |",
        "",
    ]

    # 1. Speed
    L += ["## 1. Speed", ""]
    if charts["steps"]:
        L += [f"![Where the time goes](benchmark/{charts['steps']})", ""]
    if charts["cases"]:
        L += [f"![Time per report](benchmark/{charts['cases']})", ""]
    if remote and remote.get("sequential"):
        L += [
            "### On Cloud Run, as a user sees it",
            "",
            f"Measured from {env['machine']} over the internet to `{remote['url']}`. "
            "Total = request sent to the finished guide arriving; first event = first progress "
            "line on screen.",
            "",
            "| Report | n | First event (median) | Total median | Min | Max |",
            "|---|---|---|---|---|---|",
        ]
        labels = {c["id"]: c["label"] for c in local["cases"]}
        for cid in dict.fromkeys(r["case"] for r in remote["sequential"]):
            rows = [r for r in remote["sequential"] if r["case"] == cid and r["total"]]
            if not rows:
                L.append(f"| {labels[cid]} | 0 | | failed | | |")
                continue
            t = [r["total"] for r in rows]
            fe = [r["first_event"] for r in rows]
            L.append(
                f"| {labels[cid]} | {len(t)} | {s(statistics.median(fe), 2)} s | "
                f"{s(statistics.median(t))} s | {s(min(t))} s | {s(max(t))} s |"
            )
        allt = [r["total"] for r in remote["sequential"] if r["total"]]
        sm = summary(allt)
        L += [
            "",
            f"All reports: mean {s(sm['mean'])} s, std {s(sm['std'])} s, p50 {s(sm['p50'])} s, "
            f"p90 {s(sm['p90'])} s, p95 {s(sm['p95'])} s, range {s(sm['min'])} to {s(sm['max'])} s.",
            "",
        ]
        if lighthouse and lighthouse["before"]["mobile"]["ttfb_ms"] > 2000:
            L += [
                "These runs started warm. After the service scales to zero, the first visitor "
                f"waits for a cold start: Lighthouse caught one at "
                f"{lighthouse['before']['mobile']['ttfb_ms'] / 1000:.1f} s before the first byte. "
                "A minimum of one instance during evaluation removes it.",
                "",
            ]

    L += [
        "### Each step, in process",
        "",
        "Timed from the progress events the UI shows. The two searches run in parallel.",
        "",
        "| Step | Median | p90 | Max |",
        "|---|---|---|---|",
    ]
    for k, name in STEP_NAMES.items():
        v = [r["steps"][k] for r in runs if k in r["steps"]]
        if v:
            L.append(f"| {name} | {s(pct(v, 50))} s | {s(pct(v, 90))} s | {s(max(v))} s |")
    L += ["", "Gemini calls behind them (per guide, averaged):", ""]
    L += [
        "| Call | Calls | Input tokens | Output tokens | Thinking tokens | Median time |",
        "|---|---|---|---|---|---|",
    ]
    for schema, row in _calls_by_schema(runs).items():
        L.append(
            f"| {CALL_NAMES.get(schema, schema)} | {row['calls']:.1f} | {row['input']:.0f} | "
            f"{row['output']:.0f} | {row['thinking']:.0f} | {s(statistics.median(row['seconds']), 2)} s |"
        )
    if tr:
        L += [
            "",
            f"Translation into {', '.join(tr[0]['languages'])} (both in parallel): median "
            f"{s(statistics.median(t['seconds'] for t in tr))} s, max {s(max(t['seconds'] for t in tr))} s "
            f"over {len(tr)} guides.",
        ]
    if remote and remote.get("translate"):
        tt = [t["seconds"] for t in remote["translate"] if t["ok"]]
        if tt:
            L.append(
                f"On Cloud Run (send to QA, which translates): median {s(statistics.median(tt))} s (n={len(tt)})."
            )
    L.append("")

    if remote and remote.get("features"):
        L += [
            "### Other AI features on Cloud Run",
            "",
            "| Feature (sample file) | Runs | Median | All OK |",
            "|---|---|---|---|",
        ]
        names = {
            "alarm_log": "HMI alarm export to ranked errors (CSV)",
            "controller_log": "Controller log to ranked errors (text, read by Gemini)",
            "logbook_photo": "Handwritten logbook photo to records",
            "sap_export": "SAP IW29 export to records",
        }
        for k, rows in remote["features"].items():
            t = [r["seconds"] for r in rows]
            L.append(
                f"| {names.get(k, k)} | {len(t)} | {s(statistics.median(t))} s | {'yes' if all(r['ok'] for r in rows) else 'no'} |"
            )
        L.append("")
    if remote and remote.get("voice"):
        vs = remote["voice"]
        by_mode: dict[str, list[float]] = {}
        for v in vs:
            if v.get("first_audio"):
                by_mode.setdefault(v["mode"], []).append(v["first_audio"])
        L += ["### Voice (Gemini Live)", ""]
        for mode, t in by_mode.items():
            what = (
                "end of spoken report (macOS speech, 16 kHz, sent in real time)"
                if mode == "audio"
                else "typed message"
            )
            L.append(
                f"- From the {what} to the first audio of the reply: median {s(statistics.median(t), 2)} s, max {s(max(t), 2)} s (n={len(t)})."
            )
        conn = [v["connect"] for v in vs if v.get("connect")]
        if conn:
            L.append(f"- Opening the voice session: median {s(statistics.median(conn), 2)} s.")
        errors = [v["error"] for v in vs if v.get("error")]
        if errors:
            L.append(f"- Failed sessions: {len(errors)} ({errors[0]}).")
        L.append("")

    # 2. Scale
    if remote and (remote.get("concurrent") or remote.get("light_load")):
        L += ["## 2. Scale", ""]
        if charts["load"]:
            L += [f"![Concurrent load](benchmark/{charts['load']})", ""]
        if remote.get("concurrent"):
            L += [
                "| Managers drafting at once | Finished | Median | p95 | Wall time |",
                "|---|---|---|---|---|",
            ]
            for r in remote["concurrent"]:
                lat = r["latency"]
                L.append(
                    f"| {r['concurrent']} | {r['ok']}/{r['concurrent']} | {s(lat.get('p50'))} s | "
                    f"{s(lat.get('p95'))} s | {s(r['wall'])} s |"
                )
            L.append("")
        if remote.get("light_load_before"):
            b = remote["light_load_before"]["guides_list"]
            a = remote["light_load"]["guides_list"]
            L += [
                f"**Found and fixed by this benchmark:** the guide list read every guide in full "
                f"(manual text, past incidents, translations) to show one row each. With about "
                f"45 guides and 20 people at once it managed {b['rps']:.0f} req/s, p95 "
                f"{ms(b['latency'].get('p95'))}. It now reads only the summary fields "
                f"(a Firestore projection): {a['rps']:.0f} req/s, p95 {ms(a['latency'].get('p95'))} "
                f"with {remote.get('light_load_guides', '?')} guides.",
                "",
            ]
        if remote.get("light_load"):
            L += [
                "Pages and lists with no AI call (many people opening the app):",
                "",
                "| Endpoint | Requests | At once | Throughput | p50 | p95 | Errors |",
                "|---|---|---|---|---|---|---|",
            ]
            for k, v in remote["light_load"].items():
                lat = v["latency"]
                L.append(
                    f"| {k} | {v['requests']} | {v['concurrency']} | {v['rps']:.0f} req/s | "
                    f"{ms(lat.get('p50'))} | {ms(lat.get('p95'))} | {v['errors']} |"
                )
            L.append("")

    if lighthouse:
        b, a = lighthouse["before"], lighthouse["after"]
        L += [
            "### Page load on a phone (Lighthouse)",
            "",
            f"{lighthouse['tool']}. The first mobile run also caught a cold start "
            f"({b['mobile']['ttfb_ms'] / 1000:.1f} s before the first byte); the fixes were gzip, "
            "year-long caching of content-hashed files, and loading the Telugu and Devanagari "
            "fonts only when that script is on screen.",
            "",
            "| | Performance | Accessibility | Best practices | SEO | Largest paint | Page weight |",
            "|---|---|---|---|---|---|---|",
        ]
        for when, d in (
            ("Before, phone", b["mobile"]),
            ("After, phone", a["mobile"]),
            ("After, desktop", a["desktop"]),
        ):
            sc = d["scores"]
            L.append(
                f"| {when} | {sc['performance']} | {sc['accessibility']} | {sc['best-practices']} | "
                f"{sc['seo']} | {d['lcp_s']:.1f} s | {d['bytes_kib']} KiB |"
            )
        L.append("")

    # 3. Trust
    L += ["## 3. Trust: what code checks, and what Gemini alone gets wrong", ""]
    if charts["plain"]:
        L += [f"![Plain Gemini vs PlantMemory](benchmark/{charts['plain']})", ""]
    if local.get("plain"):
        p = local["plain"]
        L += [
            "**Gemini alone.** The same model got each breakdown and the machine's name and type, "
            "and was asked for the printed repair guide with parts, settings and time. No plant "
            "data, no checks. Its values were then looked up in that machine's own manual.",
            "",
            "| Report | Part numbers in store | Values found in the machine's manual | Example part numbers it gave |",
            "|---|---|---|---|",
        ]
        labels = {c["id"]: c["label"] for c in local["cases"]}
        for x in p:
            L.append(
                f"| {labels[x['case']]} | {x['parts_real']}/{x['parts']} | "
                f"{x['values_in_plant_docs']}/{x['values']} | {', '.join(x['example_parts'])} |"
            )
        L.append("")
    if checks:

        def tot(k):
            return sum(c[k] for c in checks)

        alarm = [c["alarm_section_cited"] for c in checks if c["alarm_section_cited"] is not None]
        L += [
            f"**PlantMemory**, over {len(checks)} guides ({len(local['cases'])} reports, {local['reps']} runs each):",
            "",
            "| Measure | Result |",
            "|---|---|",
            f"| Steps citing a manual page or past fix | {rate(tot('steps_cited'), tot('steps'))} |",
            f"| All lines (safety, steps, restart checks) with a source | {rate(tot('items_cited'), tot('items'))} |",
            f"| Values with units in the guide | {tot('values')}, of which flagged for the manager: {tot('values_flagged')} |",
            f"| Citations the model made up, removed by code | {tot('citations_removed')} |",
            f"| Parts the model named that are not in the store, removed by code | {tot('parts_removed')} |",
            f"| Parts short in store, flagged with lead time | {tot('parts_short')} |",
            f"| Right machine identified | {rate(sum(c['asset_ok'] for c in checks), len(checks))} |",
            f"| Alarm code read from the report | {rate(sum(c['codes_ok'] for c in checks), len(checks))} |",
            f"| The alarm's own manual procedure cited | {rate(sum(alarm), len(alarm))} |",
            f"| Manual found when there is one, none claimed when there isn't | {rate(sum(c['manual_ok'] for c in checks), len(checks))} |",
            f"| Time estimate taken from the manual | {rate(sum(c['time_from_manual'] for c in checks), len(checks))} |",
            f"| Guides code sent to QA (something to check) | {rate(sum(c['needs_qa'] for c in checks), len(checks))} |",
            "",
        ]
    routing = local.get("manual_routing") or []
    if routing:
        n = len(routing)
        score_ok = sum(r["by_score"] == r["expected"] for r in routing)
        check_ok = sum(r["checked"] == r["expected"] for r in routing)
        none = [r for r in routing if r["expected"] is None]
        wrong_score = sum(r["by_score"] is not None for r in none)
        wrong_check = sum(r["checked"] is not None for r in none)
        L += [
            "**Reports that name no machine.** "
            f"{n} reports with no machine tag or alarm code ({len(none)} about equipment the "
            "plant has no manual for: coating pan, dryer, conveyor, compressor, HVAC, "
            "granulator, water loop). Search scores alone pick a manual for almost anything; "
            "the app asks Gemini to confirm the manual is for that equipment, and code accepts "
            "only a manual the search found.",
            "",
            "| | Search score alone | With Gemini's equipment check (live) |",
            "|---|---|---|",
            f"| Right manual, or none when there is none | {rate(score_ok, n)} | {rate(check_ok, n)} |",
            f"| A different machine's manual given | {rate(wrong_score, len(none))} | {rate(wrong_check, len(none))} |",
            "",
        ]
    if tr:
        lines = sum(t["lines"] for t in tr)
        flags = sum(len(t["flags"]) for t in tr)
        L += [
            f"Translations: {flags} of {lines} translated lines flagged for QA (a number or code not carried over).",
            "",
        ]
    if guard:
        L += [
            "**Planted faults.** Real guides from this run, with known faults planted in them, "
            "re-checked by the same code the app runs. No AI is involved, so this is exact.",
            "",
            "| Fault planted | Caught |",
            "|---|---|",
        ]
        for k, v in guard["by_kind"].items():
            L.append(f"| {k} | {rate(v['caught'], v['planted'])} |")
        L.append("")

    L += [
        "**Recognising a repeat failure.** From [EVAL_RESULTS.md](EVAL_RESULTS.md): 30 reports "
        "that should find a past incident, 16 that should not (13 deliberate look-alikes). "
        "Search score alone raised 15/16 false alarms; with Gemini checking each candidate, 0/16, "
        "while still finding 30/30. Semantic search top-1 29/30 vs keyword (BM25) 24/30; on "
        "reports that share few words with the record, 7/8 vs 2/8.",
        "",
    ]

    # 4. Cost
    L += ["## 4. Cost", ""]
    if runs:
        per_day = 10
        monthly = (guide_cost + tr_cost) * per_day * 30
        L += [
            f"Gemini cost per guide at the standard price (${PRICE['flash_in']}/M input, "
            f"${PRICE['flash_out']}/M output incl. thinking): mean **${guide_cost:.4f}** "
            f"(₹{guide_cost * USD_TO_INR:.2f}); at today's introductory price "
            f"${statistics.fmean(r['cost_usd_intro'] for r in runs):.4f}. Translation into two "
            f"languages: ${tr_cost:.4f}.",
            "",
            f"A plant with {per_day} breakdowns a day: about **${monthly:.2f} a month** "
            f"(₹{monthly * USD_TO_INR:.0f}) in Gemini calls for guides and translations. "
            "On top of that, Cloud Run keeps one instance warm, and Firestore holds a few MB per "
            "plant, inside its free tier at this size.",
            "",
        ]

    L += [
        "## How this was measured",
        "",
        "- Reports: [data/eval/benchmark_cases.json](../data/eval/benchmark_cases.json), 8 "
        "breakdowns covering an alarm code, no code, Telugu, Hindi, Telugu typed in English "
        "letters, a two-word report, a vague report and a machine with no manual.",
        "- In process: the same pipeline as the API, each report "
        f"{local['reps']} times after one warm-up, guides saved to a temporary copy of the "
        "knowledge base. Every Gemini call's tokens come from the API's usage metadata.",
        "- Cloud Run: the deployed service, from a laptop over the internet, so times include "
        "the network. Guides it created were deleted afterwards.",
        "- Gemini alone: same model and thinking level, one call per report, scored by the same "
        "code that checks PlantMemory's guides.",
        "",
        "Limits: manuals, parts and test reports are synthetic and written by the team; n is small (one run moves a rate "
        "by several points); Gemini's latency varies by minute and region; the checks catch "
        "values with units and codes, not a wrong instruction in plain words (that is what the "
        "manager's review and QA are for).",
        "",
        "Re-run:",
        "",
        "```bash",
        "uv run python -m scripts.benchmark local --reps 3",
        "uv run python -m scripts.benchmark guardrails",
        "uv run python -m scripts.benchmark remote --url https://plantmemory-4l5hbd2imq-el.a.run.app",
        "uv run python -m scripts.benchmark report",
        "```",
        "",
    ]
    DOC.write_text("\n".join(L))
    print(f"wrote {DOC.relative_to(ROOT_DIR)}; charts: {[c for c in charts.values() if c]}")
