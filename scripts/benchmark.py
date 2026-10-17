"""Benchmark PlantMemory: speed, cost, trust and scale, measured the same way every time.

Four parts, each writing raw results to docs/benchmark/<part>.json:

  local       Drafts a guide for every case in data/eval/benchmark_cases.json in this
              process, R times each: time per pipeline step, every Gemini call with its
              tokens, what code caught in each guide, and the translation. Then asks plain
              Gemini (same model, no plant data, no checks) for the same guides, so the
              difference the plant data and the code checks make is measured, not claimed.
  guardrails  No AI calls. Takes the guides from `local`, plants known faults in them
              (invented citations, changed torques, parts that don't exist, numbers
              dropped from a translation) and counts how many the code checks catch.
  remote      Against the deployed app over HTTPS, as a user sees it: time to first
              feedback and to the finished guide, the same under concurrent load, the other
              AI features, voice reply latency on Gemini Live, and plain page loads.
              Deletes every guide it created when done.
  report      Writes docs/BENCHMARK.md and the charts in docs/benchmark/ from the JSON.

Usage:
  uv run python -m scripts.benchmark local [--reps 3]
  uv run python -m scripts.benchmark guardrails
  uv run python -m scripts.benchmark remote --url https://... [--reps 3]
  uv run python -m scripts.benchmark report

Manuals, parts and test reports are synthetic; past incidents are real public records
(data/SOURCES.md). `local` uses the local store (`make seed seed-kb` first) and saves
its guides to a temporary copy of the knowledge base, never to the real one.
"""

import argparse
import asyncio
import json
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from app.agent.tools import AgentDeps
from app.config import ROOT_DIR, Settings, get_settings
from app.embeddings import GeminiEmbedder
from app.guide import guardrails
from app.guide.flow import build_guide_events
from app.guide.translate import check_translation, source_lists, translate_guide
from app.kb import KnowledgeBase, build_kb
from app.kb.loader import list_assets
from app.llm import GeminiLLM
from app.models import (
    Guide,
    GuidePartPick,
    GuideRequest,
    GuideStep,
    TranslationOut,
)
from app.store import get_store

CASES_PATH = ROOT_DIR / "data" / "eval" / "benchmark_cases.json"
OUT_DIR = ROOT_DIR / "docs" / "benchmark"
SAMPLES = ROOT_DIR / "data" / "samples"

# USD per 1M tokens for gemini-3.1-flash-lite, Vertex AI standard tier, global endpoint,
# read 14 Oct 2026 from https://cloud.google.com/vertex-ai/generative-ai/pricing. Thinking
# tokens are billed as output. It has no introductory price, so both columns are the same
# (they mattered for gemini-3.8-flash, the model used before 14 Oct).
PRICE = {
    "flash_in": 0.25,
    "flash_out": 1.50,
    "flash_in_intro": 0.25,
    "flash_out_intro": 1.50,
    "embed_in": 0.20,
}
USD_TO_INR = 88.0  # rounded; only used to show rupees next to dollars


def load_cases() -> list[dict]:
    return json.loads(CASES_PATH.read_text())["cases"]


def load_routing() -> list[dict]:
    return json.loads(CASES_PATH.read_text())["manual_routing"]


def pct(values: list[float], q: float) -> float:
    """Percentile by linear interpolation (q in 0..100)."""
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * q / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def summary(values: list[float]) -> dict:
    """The numbers every latency table reports."""
    if not values:
        return {"n": 0}
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "std": statistics.stdev(values) if len(values) > 1 else 0.0,
        "min": min(values),
        "p50": pct(values, 50),
        "p90": pct(values, 90),
        "p95": pct(values, 95),
        "max": max(values),
    }


def write_json(name: str, data: dict) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.json"
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False, default=str))
    print(f"wrote {path.relative_to(ROOT_DIR)}")
    return path


def environment() -> dict:
    s = get_settings()

    def git(*args: str) -> str:
        return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT_DIR).stdout

    commit = git("rev-parse", "--short", "HEAD").strip()
    if git("status", "--porcelain", "--untracked-files=no", "app", "web"):
        commit += " + uncommitted changes"
    return {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "commit": commit,
        "gemini_model": s.gemini_model,
        "embedding_model": s.embedding_model,
        "live_model": s.live_model,
        "thinking": s.draft_thinking_level,
        "python": platform.python_version(),
        "machine": f"{platform.system()} {platform.machine()}",
    }


# --- Metering: every Gemini and embedding call, with tokens and seconds ---


@dataclass
class Meter:
    """Collects one record per Gemini call. Thread-safe: the pipeline calls in parallel."""

    calls: list[dict] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def gemini(self, schema: str, model: str, usage, seconds: float) -> None:
        def n(attr: str) -> int:
            return int(getattr(usage, attr, 0) or 0) if usage else 0

        with self.lock:
            self.calls.append(
                {
                    "kind": "gemini",
                    "schema": schema,
                    "model": model,
                    "seconds": seconds,
                    "input": n("prompt_token_count"),
                    "output": n("candidates_token_count"),
                    "thinking": n("thoughts_token_count"),
                }
            )

    def embed(self, chars: int, seconds: float) -> None:
        with self.lock:
            # About 4 characters per token for English; a cost estimate, not a count.
            self.calls.append(
                {"kind": "embed", "schema": "embedding", "seconds": seconds, "input": chars // 4}
            )

    def take(self) -> list[dict]:
        with self.lock:
            out, self.calls = self.calls, []
        return out


class MeteredEmbedder:
    def __init__(self, inner: GeminiEmbedder, meter: Meter):
        self.inner, self.meter = inner, meter

    def embed_query(self, text: str) -> list[float]:
        start = time.perf_counter()
        vector = self.inner.embed_query(text)
        self.meter.embed(len(text), time.perf_counter() - start)
        return vector

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        start = time.perf_counter()
        vectors = self.inner.embed_documents(texts)
        self.meter.embed(sum(map(len, texts)), time.perf_counter() - start)
        return vectors


def cost_usd(calls: list[dict], intro: bool = False) -> float:
    p_in = PRICE["flash_in_intro" if intro else "flash_in"]
    p_out = PRICE["flash_out_intro" if intro else "flash_out"]
    total = 0.0
    for c in calls:
        if c["kind"] == "embed":
            total += c["input"] * PRICE["embed_in"] / 1e6
        else:
            total += (c["input"] * p_in + (c["output"] + c["thinking"]) * p_out) / 1e6
    return total


# --- What code caught in one guide ---


def _items(guide: Guide):
    return [*guide.safety, *guide.steps, *guide.restart_checks]


def guide_checks(guide: Guide, case: dict, kb: KnowledgeBase) -> dict:
    """Counts of what the guide cites and what code flagged or removed."""
    items = _items(guide)
    flags = [f for i in items for f in i.flags]
    values = [
        v
        for i in items
        for v in guardrails.values_with_units(f"{i.text} {getattr(i, 'caution', None) or ''}")
    ]
    value_flags = [f for f in flags if f.startswith("Check ")]
    expect = case["expect"]
    codes = {c.code: c for c in kb.codes.all()}
    alarm_sections = {codes[c].section_id for c in expect["codes"] if c in codes}
    cited = {c for i in items for c in i.citations}
    return {
        "steps": len(guide.steps),
        "steps_cited": sum(not s.general for s in guide.steps),
        "items": len(items),
        "items_cited": sum(not i.general for i in items),
        "citations_removed": sum(f.startswith("Cited ") for f in flags),
        "values": len(values),
        "values_flagged": len(value_flags),
        "parts": len(guide.parts),
        "parts_removed": sum("not in the plant's parts list" in f for f in guide.flags),
        "parts_short": sum(not p.in_stock for p in guide.parts),
        "past_fixes": len(guide.similar_incidents),
        "repeat": bool(guide.recurrence and guide.recurrence.is_repeat),
        "manual_sections": len(guide.manual_sections),
        "time_from_manual": guide.downtime.manual_minutes is not None,
        "needs_qa": bool(guide.qa_reasons),
        "asset_ok": guide.asset_tag == expect["asset"],
        "codes_ok": set(expect["codes"]) <= set(guide.error_codes),
        "alarm_section_cited": (alarm_sections <= cited) if alarm_sections else None,
        "manual_ok": bool(guide.manual_sections) == expect["manual"],
    }


# --- Plain Gemini, for comparison ---


class PlainPart(BaseModel):
    part_no: str
    name: str


class PlainGuide(BaseModel):
    steps: list[str]
    parts: list[PlainPart]
    estimated_minutes: int


PLAIN_PROMPT = """\
You are an experienced maintenance engineer in a manufacturing plant in India. The
maintenance manager reports this breakdown:

{text}

Machine: {machine}.

Write the repair guide the manager will print for the technicians: numbered steps with the
exact settings, torques, temperatures and pressures to use; the spare parts to collect,
with their part numbers; and how long the repair will take, in minutes.
"""


def plain_gemini(case: dict, deps: AgentDeps, kb: KnowledgeBase) -> dict:
    """The same breakdown answered by Gemini alone, scored against the plant's own records."""
    assets = {a.tag: a for a in list_assets(kb)}
    tag = case["expect"]["asset"]
    asset = assets.get(tag) if tag else None
    machine = f"{asset.tag}, a {asset.equipment_model}" if asset else "not stated"
    start = time.perf_counter()
    out = deps.llm.generate(
        PLAIN_PROMPT.format(text=case["text"], machine=machine), PlainGuide, thinking="low"
    )
    seconds = time.perf_counter() - start

    # Everything the plant has written about this machine: its manual and its history.
    known = ""
    if asset and asset.manual_id:
        known += " ".join(f"{s.title} {s.text}" for s in kb.sections.all(manual_id=asset.manual_id))
    known_values = guardrails.values_with_units(known)
    store_parts = {p.part_no for p in kb.parts.all()}
    values = [v for step in out.steps for v in guardrails.values_with_units(step)]
    return {
        "seconds": seconds,
        "steps": len(out.steps),
        "values": len(values),
        "values_in_plant_docs": sum(v in known_values for v in values),
        "parts": len(out.parts),
        "parts_real": sum(p.part_no.strip() in store_parts for p in out.parts),
        "example_parts": [p.part_no for p in out.parts[:3]],
        "estimated_minutes": out.estimated_minutes,
    }


# --- Manual routing: reports that name no machine ---


def manual_routing(deps: AgentDeps, kb: KnowledgeBase) -> list[dict]:
    """Which manual each untagged report gets: by search score alone, and with the Gemini
    equipment check the app runs (builder.confirm_manual)."""
    from app.agent import tools
    from app.embeddings import incident_text
    from app.guide.builder import find_sections

    rows = []
    for case in load_routing():
        incident = tools.structure_incident(case["text"], deps)
        vector = deps.embedder.embed_query(incident_text(incident))
        hits = [
            (sec, score)
            for sec, score in kb.sections.search(vector, k=12)
            if score >= deps.settings.manual_threshold
        ]
        by_score = hits[0][0].manual_id if hits else None
        sections, _ = find_sections(incident, [], None, deps, kb)
        checked = sections[0].manual_id if sections else None
        rows.append(
            {
                "text": case["text"],
                "expected": case["manual"],
                "top_score": hits[0][1] if hits else None,
                "by_score": by_score,
                "checked": checked,
            }
        )
        print(f"routing: {case['text'][:50]:50} score-only {by_score}, checked {checked}")
    return rows


# --- local ---


def temp_kb(settings: Settings) -> tuple[Settings, KnowledgeBase, Path]:
    """A copy of the local knowledge base, so benchmark guides never reach the real one."""
    tmp = Path(tempfile.mkdtemp(prefix="pm-bench-"))
    for name in ("manual_sections", "error_codes", "parts", "figures"):
        src = settings.local_kb_dir / f"{settings.kb_collection_prefix}{name}.json"
        if src.exists():
            shutil.copy(src, tmp / src.name)
    s = settings.model_copy(update={"local_kb_dir": tmp})
    return s, build_kb(s), tmp


async def draft_once(case: dict, deps: AgentDeps, kb: KnowledgeBase) -> dict:
    """Draft one guide, timing each step from its progress events."""
    request = GuideRequest(text=case["text"], asset_tag=case["asset"], by="Benchmark")
    start = time.perf_counter()
    started: dict[str, float] = {}
    steps: dict[str, float] = {}
    guide = None
    error = None
    async for event in build_guide_events(request, deps, kb):
        now = time.perf_counter() - start
        if event.type == "step" and event.status == "started":
            started[event.step] = now
        elif event.type == "step" and event.status == "done":
            steps[event.step] = now - started.get(event.step, now)
        elif event.type == "guide":
            guide = event.guide
        elif event.type == "error":
            error = event.detail
    return {
        "total": time.perf_counter() - start,
        "steps": steps,
        "guide": guide,
        "error": error,
    }


def run_local(reps: int, plain: bool) -> None:
    base = get_settings()
    if base.store_backend != "local":
        sys.exit("Run `local` with STORE_BACKEND=local (the remote part tests Firestore).")
    settings, kb, tmp = temp_kb(base)
    meter = Meter()
    deps = AgentDeps(
        settings=settings,
        store=get_store(),
        embedder=MeteredEmbedder(GeminiEmbedder(settings), meter),
        llm=GeminiLLM(settings, on_usage=meter.gemini),
    )
    cases = load_cases()
    runs, translations, plain_runs, routing = [], [], [], []
    try:
        # One unrecorded warm-up so connection set-up is not counted against the first case.
        asyncio.run(draft_once(cases[0], deps, kb))
        meter.take()
        for rep in range(reps):
            for case in cases:
                r = asyncio.run(draft_once(case, deps, kb))
                time.sleep(0.5)  # let a hedged copy that lost the race report its tokens
                calls = meter.take()
                guide: Guide | None = r["guide"]
                row = {
                    "case": case["id"],
                    "rep": rep,
                    "total": r["total"],
                    "steps": r["steps"],
                    "error": r["error"],
                    "calls": calls,
                    "cost_usd": cost_usd(calls),
                    "cost_usd_intro": cost_usd(calls, intro=True),
                }
                if guide:
                    row["checks"] = guide_checks(guide, case, kb)
                    row["guide"] = guide.model_dump(mode="json")
                runs.append(row)
                print(f"{case['id']} rep {rep}: {r['total']:.1f} s {r['error'] or ''}")

                if rep == 0 and guide:
                    start = time.perf_counter()
                    done = translate_guide(guide, settings.guide_languages, deps)
                    seconds = time.perf_counter() - start
                    time.sleep(0.5)
                    tcalls = meter.take()
                    translations.append(
                        {
                            "case": case["id"],
                            "seconds": seconds,
                            "languages": [t.language for t in done],
                            "lines": sum(
                                len(t.safety) + len(t.steps) + len(t.restart_checks) for t in done
                            ),
                            "flags": [f for t in done for f in t.flags],
                            "calls": tcalls,
                            "cost_usd": cost_usd(tcalls),
                            "translations": [t.model_dump(mode="json") for t in done],
                        }
                    )
                    print(
                        f"  translated in {seconds:.1f} s, {len(translations[-1]['flags'])} flags"
                    )
        routing = manual_routing(deps, kb)
        meter.take()
        if plain:
            for case in cases:
                p = plain_gemini(case, deps, kb)
                meter.take()
                plain_runs.append({"case": case["id"], **p})
                print(
                    f"plain {case['id']}: {p['parts_real']}/{p['parts']} real parts, "
                    f"{p['values_in_plant_docs']}/{p['values']} values in plant docs"
                )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    write_json(
        "local",
        {
            "env": environment(),
            "reps": reps,
            "cases": cases,
            "runs": runs,
            "translations": translations,
            "plain": plain_runs,
            "manual_routing": routing,
            "price_usd_per_1m": PRICE,
        },
    )


# --- guardrails: planted faults ---


def _changed_number(number: str) -> str:
    value = float(number)
    new = value * 1.5 if value else 7
    return f"{new:g}" if new != value else f"{value + 1:g}"


def plant_faults(guide: Guide, translations: list[dict]) -> list[dict]:
    """Plant known faults in a real guide and record whether the code checks catch each."""
    sources = guardrails.source_texts(guide.similar_incidents, guide.manual_sections)
    figures = {f for s in guide.manual_sections for f in s.figure_ids}
    results = []

    def record(kind: str, caught: bool, detail: str) -> None:
        results.append({"guide": guide.id, "kind": kind, "caught": caught, "detail": detail})

    cited_steps = [s for s in guide.steps if s.citations]
    for step in guide.steps:
        # 1. A citation to a source that was never offered (a made-up manual page or record).
        for fake in ("MAN-RTP37-99", "PHA-9999"):
            bad = step.model_copy(update={"citations": [*step.citations, fake]})
            out = guardrails.check_step(bad, sources, figures)
            record(
                "invented citation",
                fake not in out.citations and any(f.startswith("Cited ") for f in out.flags),
                fake,
            )
        # 2. A figure that is not in the offered manual sections.
        out = guardrails.check_step(
            step.model_copy(update={"figure_id": "FIG-FAKE-01"}), sources, figures
        )
        record("invented figure", out.figure_id is None, "FIG-FAKE-01")

    for step in cited_steps:
        # 3. A value from a cited source, changed: "25 Nm" becomes "37.5 Nm".
        supported = set()
        for c in step.citations:
            supported |= guardrails.values_with_units(sources.get(c, ""))
        match = next(
            (
                m
                for m in guardrails._VALUE.finditer(step.text)
                if (guardrails._num(m.group(1)), guardrails._UNITS[m.group(3).lower()]) in supported
            ),
            None,
        )
        if match:
            number = match.group(1)
            new_value = match.group(0).replace(number, _changed_number(guardrails._num(number)), 1)
            new_text = step.text[: match.start()] + new_value + step.text[match.end() :]
            out = guardrails.check_step(
                step.model_copy(update={"text": new_text}), sources, figures
            )
            record(
                "changed value",
                any(f.startswith("Check ") for f in out.flags),
                f"{match.group(0)} -> {new_value}",
            )
        # 4. A new value no cited source gives.
        out = guardrails.check_step(
            step.model_copy(update={"text": step.text + " Tighten the bolts to 37 Nm."}),
            sources,
            figures,
        )
        record("value not in source", any("37 nm" in f.lower() for f in out.flags), "37 Nm")

    # 5. A value on a line with no source at all.
    out = guardrails.check_step(
        GuideStep(text="Set the heater to 85 °C and wait 10 min.", citations=[]), sources, figures
    )
    record("value with no source", out.general and len(out.flags) == 2, "85 °C, 10 min")

    # 6. A spare part that is not in the store.
    stock = {p.part_no: p for p in guide.parts}
    for fake in ("RTP-ZZ-99", "SKF-6204-2RS"):
        parts, flags = guardrails.check_parts([GuidePartPick(part_no=fake, qty=1)], stock)
        record("invented part", not parts and any(fake in f for f in flags), fake)

    # 7-9. Translations: a number dropped, a code changed, a line missing.
    for t in translations:
        src = source_lists(guide)
        out = TranslationOut(**{k: t[k] for k in TranslationOut.model_fields})
        clean = set(check_translation(src, out))
        for i, line in enumerate(src["steps"]):
            tline = out.steps[i] if i < len(out.steps) else ""
            numbers = guardrails._VALUE.findall(line)
            if numbers and tline:
                first = numbers[0][0]
                for variant in {first, first.replace(".", ",")}:
                    if variant in tline:
                        dropped = out.model_copy(
                            update={
                                "steps": [
                                    *out.steps[:i],
                                    tline.replace(variant, "", 1),
                                    *out.steps[i + 1 :],
                                ]
                            }
                        )
                        new = set(check_translation(src, dropped)) - clean
                        record(f"translation: number dropped ({t['language']})", bool(new), first)
                        break
            codes = translate_tokens(line)
            if codes and tline and codes[0] in tline:
                swapped = out.model_copy(
                    update={
                        "steps": [
                            *out.steps[:i],
                            tline.replace(codes[0], codes[0][::-1], 1),
                            *out.steps[i + 1 :],
                        ]
                    }
                )
                new = set(check_translation(src, swapped)) - clean
                record(f"translation: code changed ({t['language']})", bool(new), codes[0])
        if out.steps:
            missing = out.model_copy(update={"steps": [*out.steps[:-1], ""]})
            new = set(check_translation(src, missing)) - clean
            record(f"translation: line missing ({t['language']})", bool(new), "last step")
    return results


def translate_tokens(line: str) -> list[str]:
    from app.guide.translate import _TOKEN

    return [t for t in dict.fromkeys(_TOKEN.findall(line)) if t != t[::-1]]


def run_guardrails() -> None:
    local = json.loads((OUT_DIR / "local.json").read_text())
    by_case = {t["case"]: t["translations"] for t in local["translations"]}
    results = []
    for run in local["runs"]:
        if "guide" not in run or run["rep"] != 0:
            continue
        guide = Guide.model_validate(run["guide"])
        results += plant_faults(guide, by_case.get(run["case"], []))
    kinds: dict[str, list[bool]] = {}
    for r in results:
        kind = r["kind"].split(" (")[0]
        kinds.setdefault(kind, []).append(r["caught"])
    table = {k: {"planted": len(v), "caught": sum(v)} for k, v in kinds.items()}
    for k, v in table.items():
        print(f"{k:32} {v['caught']}/{v['planted']}")
    write_json("guardrails", {"env": environment(), "by_kind": table, "faults": results})


# --- remote ---


@dataclass
class Remote:
    url: str
    created: list[str] = field(default_factory=list)


async def stream_guide(client, r: Remote, case: dict) -> dict:
    """Draft one guide over HTTPS, timing the first event, each step and the guide."""
    body = {"text": case["text"], "asset_tag": case["asset"], "by": "Benchmark"}
    start = time.perf_counter()
    first = None
    started: dict[str, float] = {}
    steps: dict[str, float] = {}
    guide_id = error = None
    try:
        async with client.stream("POST", f"{r.url}/api/guides/stream", json=body) as resp:
            if resp.status_code != 200:
                return {"case": case["id"], "error": f"HTTP {resp.status_code}", "total": None}
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                now = time.perf_counter() - start
                first = first if first is not None else now
                event = json.loads(line[5:].strip())
                if event.get("type") == "step" and event.get("status") == "started":
                    started[event["step"]] = now
                elif event.get("type") == "step" and event.get("status") == "done":
                    steps[event["step"]] = now - started.get(event["step"], now)
                elif event.get("type") == "guide":
                    guide_id = event["guide"]["id"]
                    r.created.append(guide_id)
                elif event.get("type") == "error":
                    error = event.get("detail")
    except Exception as err:  # timeouts and dropped connections count as failures
        error = f"{type(err).__name__}: {err}"
    total = time.perf_counter() - start
    return {
        "case": case["id"],
        "first_event": first,
        "steps": steps,
        "total": total if guide_id else None,
        "guide_id": guide_id,
        "error": error,
    }


async def timed_post(client, url: str, **kwargs) -> dict:
    start = time.perf_counter()
    try:
        resp = await client.post(url, **kwargs)
        ok = resp.status_code < 400
        detail = None if ok else f"HTTP {resp.status_code}: {resp.text[:200]}"
        data = resp.json() if ok else None
    except Exception as err:
        ok, detail, data = False, f"{type(err).__name__}: {err}", None
    return {"seconds": time.perf_counter() - start, "ok": ok, "error": detail, "data": data}


async def light_load(client, url: str, total: int, concurrency: int) -> dict:
    """Many cheap requests at once: how the app holds up when lots of people open it."""
    sem = asyncio.Semaphore(concurrency)
    times, errors = [], 0

    async def one():
        nonlocal errors
        async with sem:
            start = time.perf_counter()
            try:
                resp = await client.get(url)
                if resp.status_code >= 400:
                    errors += 1
                else:
                    times.append(time.perf_counter() - start)
            except Exception:
                errors += 1

    start = time.perf_counter()
    await asyncio.gather(*(one() for _ in range(total)))
    wall = time.perf_counter() - start
    return {
        "requests": total,
        "concurrency": concurrency,
        "errors": errors,
        "rps": total / wall,
        "latency": summary(times),
    }


def speech_pcm(text: str) -> bytes | None:
    """16 kHz mono PCM of `text` spoken by macOS `say`, or None where that is missing."""
    if shutil.which("say") is None or shutil.which("afconvert") is None:
        return None
    with tempfile.TemporaryDirectory() as d:
        aiff, wav = Path(d) / "s.aiff", Path(d) / "s.wav"
        subprocess.run(["say", "-o", str(aiff), text], check=True)
        subprocess.run(
            ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)],
            check=True,
        )
        data = wav.read_bytes()
    return data[data.find(b"data") + 8 :]  # skip the WAV header


async def voice_turn(url: str, pcm: bytes | None, text: str) -> dict:
    """One spoken turn on Gemini Live: seconds from the end of the manager's speech (or the
    typed message) to the first byte of the spoken reply."""
    import websockets

    ws_url = url.replace("https://", "wss://").replace("http://", "ws://") + "/api/intake/live"
    start_connect = time.perf_counter()
    async with websockets.connect(ws_url, max_size=None) as ws:
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), 20))
            if msg["type"] == "ready":
                break
            if msg["type"] == "error":
                return {"error": msg["message"]}
        connect = time.perf_counter() - start_connect
        if pcm:
            chunk = 3200  # 100 ms of 16 kHz 16-bit audio, sent in real time like a microphone
            for i in range(0, len(pcm), chunk):
                await ws.send(pcm[i : i + chunk])
                await asyncio.sleep(0.1)
            silence = b"\0" * chunk
            sent = time.perf_counter()
            for _ in range(15):  # trailing silence, as a microphone would send
                await ws.send(silence)
                await asyncio.sleep(0.1)
                if _ == 0:
                    sent = time.perf_counter()
        else:
            sent = time.perf_counter()
            await ws.send(json.dumps({"type": "text", "text": text}))
        first_audio = None
        deadline = time.perf_counter() + 30
        while time.perf_counter() < deadline:
            try:
                msg = await asyncio.wait_for(ws.recv(), 30)
            except TimeoutError:
                break
            if isinstance(msg, bytes):
                first_audio = time.perf_counter() - sent
                break
        await ws.send(json.dumps({"type": "end"}))
    return {"connect": connect, "first_audio": first_audio, "mode": "audio" if pcm else "text"}


def delete_created(ids: list[str]) -> int:
    """Remove the benchmark's guides from Firestore so the demo data stays clean."""
    if not ids:
        return 0
    from google.cloud import firestore

    s = get_settings()
    client = firestore.Client(project=s.google_cloud_project, database=s.firestore_database)
    coll = client.collection(f"{s.kb_collection_prefix}guides")
    for gid in ids:
        coll.document(gid).delete()
    return len(ids)


async def run_remote_async(r: Remote, reps: int, concurrency: list[int], voice: int) -> dict:
    import httpx

    cases = load_cases()
    out: dict = {"url": r.url}
    timeout = httpx.Timeout(180.0, connect=30.0)
    limits = httpx.Limits(max_connections=100, max_keepalive_connections=100)
    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        # Cold start: the very first request, if the service had scaled to zero.
        start = time.perf_counter()
        health = await client.get(f"{r.url}/health")
        out["first_health"] = {"seconds": time.perf_counter() - start, "status": health.status_code}
        print(f"first /health {out['first_health']['seconds']:.2f} s")

        out["warmup"] = await stream_guide(client, r, cases[0])
        print(f"warm-up guide {out['warmup']['total']}")

        sequential = []
        for rep in range(reps):
            for case in cases:
                row = await stream_guide(client, r, case)
                row["rep"] = rep
                sequential.append(row)
                print(
                    f"{case['id']} rep {rep}: first {row['first_event']}, total {row['total']}",
                    row["error"] or "",
                )
        out["sequential"] = sequential

        # Translation into Telugu and Hindi, as when a guide goes to QA.
        submits = []
        for row in sequential[: min(3, len(sequential))]:
            if row["guide_id"]:
                res = await timed_post(
                    client, f"{r.url}/api/guides/{row['guide_id']}/submit", json={"by": "Benchmark"}
                )
                flags = (
                    sum(len(t["flags"]) for t in res["data"]["translations"])
                    if res["data"]
                    else None
                )
                submits.append(
                    {
                        "case": row["case"],
                        "seconds": res["seconds"],
                        "ok": res["ok"],
                        "flags": flags,
                        "error": res["error"],
                    }
                )
                print(f"submit+translate {res['seconds']:.1f} s ok={res['ok']}")
        out["translate"] = submits

        # Several managers drafting at once.
        load = []
        for n in concurrency:
            picked = [cases[i % len(cases)] for i in range(n)]
            start = time.perf_counter()
            rows = await asyncio.gather(*(stream_guide(client, r, c) for c in picked))
            wall = time.perf_counter() - start
            ok = [x["total"] for x in rows if x["total"] is not None]
            load.append(
                {
                    "concurrent": n,
                    "ok": len(ok),
                    "errors": [x["error"] for x in rows if x["total"] is None],
                    "wall": wall,
                    "latency": summary(ok),
                    "first_event": summary(
                        [x["first_event"] for x in rows if x["first_event"] is not None]
                    ),
                }
            )
            print(f"{n} at once: {len(ok)}/{n} ok, p50 {load[-1]['latency'].get('p50')}")
        out["concurrent"] = load

        # The other AI features, with the sample files the UI offers.
        features = {}
        samples = {
            "alarm_log": ("/api/logs/analyze", "alarm_log_tp02.csv", "text/csv", {}),
            "controller_log": ("/api/logs/analyze", "cycle_log_ac2.txt", "text/plain", {}),
            "logbook_photo": ("/api/ingest/logbook", "logbook_granulation_01.png", "image/png", {}),
            "sap_export": ("/api/ingest/cmms", "sap_iw29_export.csv", "text/csv", {}),
        }
        for name, (path, filename, mime, form) in samples.items():
            rows = []
            for _ in range(2):
                data = (SAMPLES / filename).read_bytes()
                res = await timed_post(
                    client, f"{r.url}{path}", files={"file": (filename, data, mime)}, data=form
                )
                rows.append({"seconds": res["seconds"], "ok": res["ok"], "error": res["error"]})
            features[name] = rows
            print(f"{name}: {[round(x['seconds'], 1) for x in rows]}")
        out["features"] = features

        # Pages and lists: no AI, many people at once.
        out["light_load"] = {
            "health": await light_load(client, f"{r.url}/health", 300, 30),
            "guides_list": await light_load(client, f"{r.url}/api/guides", 200, 20),
            "home_page": await light_load(client, f"{r.url}/", 200, 20),
        }
        for k, v in out["light_load"].items():
            print(
                f"{k}: {v['rps']:.0f} req/s,",
                f"p95 {v['latency'].get('p95', 0) * 1000:.0f} ms, errors {v['errors']}",
            )

    # Voice on Gemini Live.
    pcm = speech_pcm(
        "Tablet press T P zero two has stopped. The screen shows alarm E 104, punch tight."
    )
    turns = []
    for i in range(voice):
        for audio in [pcm, None] if pcm else [None]:
            try:
                res = await voice_turn(r.url, audio, "TP-02 stopped with alarm E-104, punch tight.")
            except Exception as err:
                res = {"error": f"{type(err).__name__}: {err}"}
            turns.append(res)
            print(f"voice {i}: {res}")
    out["voice"] = turns
    return out


def run_remote(url: str, reps: int, concurrency: list[int], voice: int, keep: bool) -> None:
    r = Remote(url=url.rstrip("/"))
    try:
        out = asyncio.run(run_remote_async(r, reps, concurrency, voice))
    finally:
        if not keep:
            print(f"deleted {delete_created(r.created)} benchmark guides from Firestore")
    out["env"] = environment()
    write_json("remote", out)


def run_lists(url: str, guides: int) -> None:
    """Page and list loads only (no AI calls), with `guides` copies of a real guide in
    Firestore, so the list is measured at a realistic size. Updates remote.json."""
    import httpx
    from google.cloud import firestore

    s = get_settings()
    client = firestore.Client(project=s.google_cloud_project, database=s.firestore_database)
    coll = client.collection(f"{s.kb_collection_prefix}guides")
    template = next(iter(coll.limit(1).stream())).to_dict()
    ids = [f"GDE-BENCH{i:03d}" for i in range(guides)]
    for start in range(0, len(ids), 400):
        batch = client.batch()
        for gid in ids[start : start + 400]:
            batch.set(coll.document(gid), {**template, "id": gid})
        batch.commit()
    total = len(list(coll.select(["id"]).stream()))
    print(f"{total} guides in Firestore")

    async def go() -> dict:
        limits = httpx.Limits(max_connections=100, max_keepalive_connections=100)
        async with httpx.AsyncClient(timeout=60, limits=limits) as c:
            base = url.rstrip("/")
            return {
                "health": await light_load(c, f"{base}/health", 300, 30),
                "guides_list": await light_load(c, f"{base}/api/guides", 200, 20),
                "home_page": await light_load(c, f"{base}/", 200, 20),
            }

    try:
        result = asyncio.run(go())
    finally:
        print(f"deleted {delete_created(ids)} copies")
    for k, v in result.items():
        p95 = v["latency"].get("p95", 0) * 1000
        print(f"{k}: {v['rps']:.0f} req/s, p95 {p95:.0f} ms, errors {v['errors']}")
    path = OUT_DIR / "remote.json"
    data = json.loads(path.read_text()) if path.exists() else {"url": url}
    if "light_load" in data and "light_load_before" not in data:
        data["light_load_before"] = data["light_load"]
    data["light_load"] = result
    data["light_load_guides"] = total
    write_json("remote", data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="part", required=True)
    p = sub.add_parser("local")
    p.add_argument("--reps", type=int, default=3)
    p.add_argument("--no-plain", action="store_true", help="skip the plain-Gemini comparison")
    sub.add_parser("guardrails")
    p = sub.add_parser("remote")
    p.add_argument("--url", required=True)
    p.add_argument("--reps", type=int, default=3)
    p.add_argument("--concurrency", default="1,4,8")
    p.add_argument("--voice", type=int, default=3)
    p.add_argument("--keep", action="store_true", help="keep the guides it creates")
    p = sub.add_parser("lists")
    p.add_argument("--url", required=True)
    p.add_argument("--guides", type=int, default=45)
    sub.add_parser("report")
    args = parser.parse_args()
    if args.part == "local":
        run_local(args.reps, plain=not args.no_plain)
    elif args.part == "guardrails":
        run_guardrails()
    elif args.part == "lists":
        run_lists(args.url, args.guides)
    elif args.part == "remote":
        run_remote(
            args.url,
            args.reps,
            [int(x) for x in args.concurrency.split(",")],
            args.voice,
            args.keep,
        )
    else:
        from scripts.benchmark_report import write_report

        write_report()


if __name__ == "__main__":
    main()
