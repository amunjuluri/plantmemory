"""Scale benchmark: does plant-memory search hold up with 50,000 past repairs?

The demo's memory holds 17 real repairs. A plant group would hold tens of thousands, so
this loads about 50,000 real FDA device reports (openFDA MAUDE, public domain) on
sterilizers, washer-disinfectors, compressors, beds, surgical lights, anaesthesia
machines and other serviced equipment, plus the 17 demo records, into separate
Firestore collections, one per size. It then times the app's own vector search
(FirestoreStore.search, k=5, as the agent calls it) and checks the demo's test reports
still find their records when buried among the rest.

It never touches the app's collections: every write goes through `scale_store`, which
only accepts names starting with "scale_incidents".

Steps, each safe to re-run (finished work is skipped):

  uv run python -m scripts.scale_benchmark fetch    # openFDA -> data/store/scale/maude/
  uv run python -m scripts.scale_benchmark indexes  # one vector index per collection (gcloud)
  uv run python -m scripts.scale_benchmark load     # embed, then write the collections
  uv run python -m scripts.scale_benchmark run      # latency and accuracy per size
  uv run python -m scripts.scale_benchmark chart    # docs/benchmark/scale.png

Needs Firestore access and Vertex AI through Application Default Credentials. The
collections are named in code, so STORE_BACKEND and FIRESTORE_COLLECTION are not used.
"""

import argparse
import json
import platform
import random
import re
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime

import httpx
import numpy as np

from app.config import ROOT_DIR, get_settings
from app.embeddings import GeminiEmbedder, incident_text
from app.models import IncidentRecord
from app.store.firestore_store import FirestoreStore
from scripts.benchmark import OUT_DIR, PRICE, pct
from scripts.seed import load_seed_records

DATA_DIR = ROOT_DIR / "data" / "store" / "scale"
MAUDE_DIR = DATA_DIR / "maude"
VECTOR_DIR = DATA_DIR / "vectors"
CASES_PATH = ROOT_DIR / "data" / "eval" / "retrieval_cases.json"
RESULT_NAME = "scale"

OPENFDA_URL = "https://api.fda.gov/device/event.json"
PAGE = 500  # largest page openFDA serves without an API key (1000 needs one)
SKIP_CAP = 25000  # openFDA refuses skip beyond this
REQUEST_GAP = 0.3  # seconds between requests: 200 a minute, under the 240 allowed

# Product codes for equipment a service technician repairs, with how many of the newest
# reports with narrative text to fetch for each. Codes with fewer reports give all they have.
PRODUCT_CODES = {
    "FLE": ("steam sterilizer", 1600),
    "MLR": ("hydrogen peroxide (STERRAD) sterilizer", 5300),
    "MEC": ("washer-disinfector", 1400),
    "FEB": ("endoscope reprocessor", 5100),
    "BTI": ("portable air compressor", 5900),
    "FQO": ("surgical table", 2400),
    "FSY": ("ceiling-mounted surgical light", 5200),
    "FNL": ("powered hospital bed", 9000),
    "BSZ": ("anaesthesia gas machine", 6000),
    "DTQ": ("heart-lung machine console", 4000),
    "CBK": ("ventilator", 4000),
    "IZI": ("angiographic X-ray system", 3000),
    "BRY": ("automated dispensing cabinet", 3000),
    "KPA": ("automated slide stainer", 1449),
}

COLLECTION_PREFIX = "scale_incidents"
# Collection sizes, each holding the 17 demo records plus the first N-17 of a fixed
# shuffle of the public reports, so every smaller collection is inside the larger ones.
SIZES = [17, 1000, 10000, 50000]

# Text limits per field, so one long report doesn't dominate the cost. Most of a report's
# meaning (what failed, what the technician found and did) is in its first few sentences.
MAX_DESCRIPTION = 700
MAX_ACTION = 700
MIN_DESCRIPTION = 60

# Firestore Standard edition, asia-south1, USD (read 17 Oct 2026 from
# https://cloud.google.com/firestore/pricing). A vector query is billed one read per 100
# index entries scanned plus one per document returned.
FIRESTORE_PRICE = {"write_per_100k": 0.18, "read_per_100k": 0.06}
EMBED_CHUNK = 50
EMBED_WORKERS = 4  # chunks embedded at once; GeminiEmbedder makes 8 requests per chunk


def collection_name(size: int) -> str:
    return f"{COLLECTION_PREFIX}_{size // 1000}k" if size >= 1000 else f"{COLLECTION_PREFIX}_{size}"


def scale_store(name: str) -> FirestoreStore:
    """A store on one scale collection. Refuses any other name, so the app's data is safe."""
    if not name.startswith(COLLECTION_PREFIX + "_"):
        raise ValueError(f"refusing to use collection {name!r}: not a scale collection")
    s = get_settings()
    return FirestoreStore(
        database=s.firestore_database, collection=name, project=s.google_cloud_project
    )


# --- MAUDE report -> IncidentRecord ---


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _clip(text: str, limit: int) -> str:
    """Cut at a word boundary, marking the cut."""
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:.") + " ..."


def _parse_date(value: str | None) -> date | None:
    if not value or not re.fullmatch(r"\d{8}", value):
        return None
    try:
        parsed = date(int(value[:4]), int(value[4:6]), int(value[6:]))
    except ValueError:
        return None
    return parsed if date(1990, 1, 1) <= parsed <= date.today() else None


def maude_to_record(report: dict) -> IncidentRecord | None:
    """One openFDA device event as a public past repair, or None if it has no usable text.

    Shaped like the demo's seed records: the event description is what went wrong, the
    manufacturer's narrative (where the service technician's findings are) is what was
    done. Text is kept as reported, cut to a few sentences; there is no structured cause.
    """
    key = str(report.get("mdr_report_key") or "").strip()
    texts = report.get("mdr_text") or []
    event = " ".join(
        _clean(t.get("text", ""))
        for t in texts
        if t.get("text_type_code") == "Description of Event or Problem"
    ).strip()
    narrative = " ".join(
        _clean(t.get("text", ""))
        for t in texts
        if t.get("text_type_code") != "Description of Event or Problem"
    ).strip()
    if not key or len(event) < MIN_DESCRIPTION:
        return None
    when = _parse_date(report.get("date_of_event")) or _parse_date(report.get("date_received"))
    if when is None:
        return None

    device = (report.get("device") or [{}])[0]
    code = device.get("device_report_product_code") or ""
    generic = _clean(device.get("generic_name") or "") or PRODUCT_CODES.get(code, ("",))[0]
    brand = _clean(device.get("brand_name") or "")
    maker = _clean(device.get("manufacturer_d_name") or "")
    equipment = ", ".join(p for p in (generic.capitalize(), brand or maker) if p)

    return IncidentRecord(
        id=f"MDR-{key}",
        industry="healthcare",
        date=when,
        area_or_equipment=_clip(equipment or "Medical equipment", 120),
        description=_clip(event, MAX_DESCRIPTION),
        action_taken=_clip(narrative, MAX_ACTION) or None,
        outcome="unknown",
        source="public_record",
        source_ref=(
            "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/detail.cfm"
            f"?mdrfoi__id={key}&pc={code}"
        ),
    )


# --- fetch ---


def _slim(report: dict) -> dict:
    """Only the fields the mapping reads, to keep the download small."""
    keep_device = ("device_report_product_code", "generic_name", "brand_name")
    keep_device += ("manufacturer_d_name", "model_number")
    return {
        "mdr_report_key": report.get("mdr_report_key"),
        "date_of_event": report.get("date_of_event"),
        "date_received": report.get("date_received"),
        "event_type": report.get("event_type"),
        "device": [{k: d.get(k) for k in keep_device} for d in (report.get("device") or [])[:1]],
        "mdr_text": [
            {"text_type_code": t.get("text_type_code"), "text": t.get("text")}
            for t in report.get("mdr_text") or []
        ],
    }


def _get(client: httpx.Client, params: dict) -> dict:
    for attempt in range(6):
        response = client.get(OPENFDA_URL, params=params)
        if response.status_code == 404:  # openFDA's "no more results"
            return {"results": []}
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(min(60, 5 * 2**attempt))
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"openFDA kept failing for {params}")


def fetch() -> None:
    MAUDE_DIR.mkdir(parents=True, exist_ok=True)
    requests = 0
    with httpx.Client(timeout=120) as client:
        for code, (label, quota) in PRODUCT_CODES.items():
            path = MAUDE_DIR / f"{code}.jsonl"
            if path.exists():
                print(f"{code} ({label}): already fetched, {sum(1 for _ in path.open())} reports")
                continue
            rows: list[dict] = []
            while len(rows) < quota and len(rows) < SKIP_CAP:
                params = {
                    "search": f"device.device_report_product_code:{code} AND _exists_:mdr_text",
                    "sort": "date_received:desc",
                    "limit": min(PAGE, quota - len(rows)),
                    "skip": len(rows),
                }
                page = _get(client, params).get("results") or []
                requests += 1
                time.sleep(REQUEST_GAP)
                if not page:
                    break
                rows.extend(_slim(r) for r in page)
            tmp = path.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
            tmp.rename(path)
            print(f"{code} ({label}): {len(rows)} reports")
    print(f"done, {requests} openFDA requests")


# --- the records each collection holds ---


def public_records() -> list[IncidentRecord]:
    """Every fetched report with usable text, minus the demo's own, in a fixed shuffle."""
    seed_ids = {r.id for r in load_seed_records()}
    seen: set[str] = set()
    out = []
    for code in PRODUCT_CODES:
        path = MAUDE_DIR / f"{code}.jsonl"
        if not path.exists():
            sys.exit(f"{path} missing: run `fetch` first")
        for line in path.open():
            record = maude_to_record(json.loads(line))
            if record and record.id not in seed_ids and record.id not in seen:
                seen.add(record.id)
                out.append(record)
    out.sort(key=lambda r: r.id)
    random.Random(17).shuffle(out)
    return out


def plan(public: list[IncidentRecord]) -> dict[int, list[IncidentRecord]]:
    """Records per collection size: the 17 demo records plus the first N-17 public ones.

    If fewer reports were usable than the largest size needs, that collection holds all
    there are (its real count is what gets reported).
    """
    seed = load_seed_records()
    return {n: seed + public[: n - len(seed)] for n in SIZES}


# --- vectors, cached on disk so an interrupted run resumes ---


def load_vectors() -> dict[str, np.ndarray]:
    vectors: dict[str, np.ndarray] = {}
    for shard in sorted(VECTOR_DIR.glob("*.npz")):
        data = np.load(shard)
        vectors.update(zip(data["ids"].tolist(), data["vectors"], strict=True))
    return vectors


def _embed_chunk(embedder: GeminiEmbedder, chunk: list[IncidentRecord]) -> tuple[list, list]:
    texts = [incident_text(r) for r in chunk]
    for attempt in range(8):
        try:
            return [r.id for r in chunk], embedder.embed_documents(texts)
        except Exception as error:  # quota and transient errors: back off and retry
            wait = min(120, 4 * 2**attempt)
            print(f"  embed retry in {wait}s: {str(error)[:120]}", flush=True)
            time.sleep(wait)
    raise RuntimeError("embedding kept failing")


def embed_missing(records: list[IncidentRecord]) -> dict[str, np.ndarray]:
    VECTOR_DIR.mkdir(parents=True, exist_ok=True)
    vectors = load_vectors()
    todo = [r for r in records if r.id not in vectors]
    print(f"vectors cached: {len(vectors)}, to embed: {len(todo)}", flush=True)
    if not todo:
        return vectors
    embedder = GeminiEmbedder(get_settings())
    chunks = [todo[i : i + EMBED_CHUNK] for i in range(0, len(todo), EMBED_CHUNK)]
    start, done = time.time(), 0
    with ThreadPoolExecutor(max_workers=EMBED_WORKERS) as pool:
        futures = [pool.submit(_embed_chunk, embedder, c) for c in chunks]
        for future in as_completed(futures):
            ids, vecs = future.result()
            array = np.asarray(vecs, dtype=np.float32)
            stamp = f"{time.time_ns()}"
            np.savez(VECTOR_DIR / f"{stamp}.npz", ids=np.asarray(ids), vectors=array)
            vectors.update(zip(ids, array, strict=True))
            done += len(ids)
            if done % 1000 < EMBED_CHUNK:
                rate = done / (time.time() - start)
                left = (len(todo) - done) / rate / 60
                print(f"  embedded {done}/{len(todo)} ({rate:.0f}/s, ~{left:.0f} min left)")
    return vectors


# --- cost estimate ---


def estimate(by_size: dict[int, list[IncidentRecord]], cached: set[str], queries: int) -> dict:
    largest = by_size[max(by_size)]
    to_embed = [r for r in largest if r.id not in cached]
    tokens = sum(len(incident_text(r)) for r in to_embed) // 4  # ~4 chars per token
    embed_usd = tokens * PRICE["embed_in"] / 1e6
    writes = sum(len(rs) for rs in by_size.values())
    write_usd = writes * FIRESTORE_PRICE["write_per_100k"] / 1e5
    # Listing ids to skip on resume (one read each), then the benchmark's vector queries.
    reads = writes + sum(queries * (len(rs) / 100 + 5) for rs in by_size.values())
    read_usd = reads * FIRESTORE_PRICE["read_per_100k"] / 1e5
    return {
        "records_to_embed": len(to_embed),
        "embed_tokens_est": tokens,
        "embed_usd": round(embed_usd, 3),
        "firestore_writes": writes,
        "firestore_write_usd": round(write_usd, 3),
        "firestore_reads_est": int(reads),
        "firestore_read_usd": round(read_usd, 3),
        "total_usd": round(embed_usd + write_usd + read_usd, 2),
    }


# --- load ---


def existing_ids(store: FirestoreStore) -> set[str]:
    return {snap.id for snap in store.collection.select([]).stream()}


def load(max_usd: float, queries: int) -> None:
    by_size = plan(public_records())
    cached = set(load_vectors())
    cost = estimate(by_size, cached, queries)
    print("plan:", {collection_name(n): len(rs) for n, rs in by_size.items()})
    print("estimated spend (USD):", json.dumps(cost, indent=1))
    if cost["total_usd"] > max_usd:
        sys.exit(f"estimate ${cost['total_usd']} is over --max-usd {max_usd}; stopping")

    vectors = embed_missing(by_size[max(by_size)])
    for size, records in sorted(by_size.items()):
        name = collection_name(size)
        store = scale_store(name)
        have = existing_ids(store)
        todo = [r for r in records if r.id not in have]
        print(f"{name}: {len(have)} already there, writing {len(todo)}", flush=True)
        for i in range(0, len(todo), 2000):
            batch = todo[i : i + 2000]
            for r in batch:
                r.embedding = vectors[r.id].tolist()
            store.upsert(batch)
            for r in batch:
                r.embedding = None
            print(f"  {name}: {len(have) + i + len(batch)}/{len(records)}", flush=True)


# --- indexes ---


def indexes() -> None:
    s = get_settings()
    vector = f'vector-config={{"dimension":"{s.embedding_dim}","flat":"{{}}"}},field-path=embedding'
    for size in SIZES:
        name = collection_name(size)
        cmd = [
            "gcloud",
            "firestore",
            "indexes",
            "composite",
            "create",
            f"--collection-group={name}",
            "--query-scope=COLLECTION",
            f"--field-config={vector}",
            f"--project={s.google_cloud_project}",
            "--async",
        ]
        out = subprocess.run(cmd, capture_output=True, text=True)
        text = out.stdout + out.stderr
        status = "requested" if out.returncode == 0 else text.strip().splitlines()[-1]
        print(f"{name}: {'exists' if 'already exists' in text.lower() else status}")


# --- run: latency and accuracy per size ---


def _summary_ms(seconds: list[float]) -> dict:
    ms = [x * 1000 for x in seconds]
    return {
        "n": len(ms),
        "p50": pct(ms, 50),
        "p95": pct(ms, 95),
        "p99": pct(ms, 99),
        "mean": statistics.fmean(ms),
        "min": min(ms),
        "max": max(ms),
    }


def latency_queries(n_extra: int) -> list[str]:
    """The eval's test reports plus held-out real event descriptions (not in any collection)."""
    spec = json.loads(CASES_PATH.read_text())
    queries = [c["query"] for c in spec["cases"]] + [n["query"] for n in spec["negatives"]]
    used = {r.id for rs in plan(public_records()).values() for r in rs}
    held_out = []
    for code in PRODUCT_CODES:
        for line in (MAUDE_DIR / f"{code}.jsonl").open():
            record = maude_to_record(json.loads(line))
            if record and record.id not in used:
                held_out.append(record.description[:300])
    random.Random(5).shuffle(held_out)
    return queries + held_out[:n_extra]


def accuracy(store: FirestoreStore, spec: dict, qvecs: dict, threshold: float) -> dict:
    rows, negatives = [], []
    for case in spec["cases"]:
        expected = set(case["expected"])
        hits = store.search(qvecs[case["query"]], k=5)
        ids = [h.record.id for h in hits]
        above = [h for h in hits if h.score >= threshold]
        rows.append(
            {
                "id": case["id"],
                "low_keyword": case["low_keyword"],
                "top5": ids,
                "scores": [round(h.score, 4) for h in hits],
                "top1": ids[0] in expected,
                "top3": bool(expected & set(ids[:3])),
                "top5_hit": bool(expected & set(ids)),
                "expected_in_top5": len(expected & set(ids)),
                "candidates": len(above),
                "candidates_expected": sum(h.record.id in expected for h in above),
                "first_wrong": next(
                    (
                        {
                            "id": h.record.id,
                            "equipment": h.record.area_or_equipment,
                            "description": h.record.description[:200],
                            "score": round(h.score, 4),
                        }
                        for h in hits
                        if h.record.id not in expected
                    ),
                    None,
                ),
            }
        )
    for neg in spec["negatives"]:
        hits = store.search(qvecs[neg["query"]], k=5)
        above = [h for h in hits if h.score >= threshold]
        negatives.append(
            {
                "id": neg["id"],
                "kind": neg.get("kind"),
                "best": round(hits[0].score, 4) if hits else None,
                "candidates": len(above),
                "best_record": (
                    {
                        "id": hits[0].record.id,
                        "equipment": hits[0].record.area_or_equipment,
                        "description": hits[0].record.description[:200],
                    }
                    if hits
                    else None
                ),
            }
        )
    n = len(rows)
    return {
        "cases": rows,
        "negatives": negatives,
        "top1": sum(r["top1"] for r in rows),
        "top3": sum(r["top3"] for r in rows),
        "top5": sum(r["top5_hit"] for r in rows),
        "n_cases": n,
        "cases_with_expected_candidate": sum(r["candidates_expected"] > 0 for r in rows),
        "negatives_with_candidate": sum(x["candidates"] > 0 for x in negatives),
        "n_negatives": len(negatives),
    }


def run(rounds: int, n_extra: int) -> None:
    s = get_settings()
    spec = json.loads(CASES_PATH.read_text())
    queries = latency_queries(n_extra)
    print(f"embedding {len(queries)} queries", flush=True)
    embedder = GeminiEmbedder(s)
    qvecs = {}
    for i in range(0, len(queries), EMBED_CHUNK):
        chunk = queries[i : i + EMBED_CHUNK]
        qvecs.update(zip(chunk, [embedder.embed_query(q) for q in chunk], strict=True))

    by_size = plan(public_records())
    results = []
    for size in sorted(by_size):
        name = collection_name(size)
        store = scale_store(name)
        count = store.count()
        # Network floor: fetching one small document by id from this machine.
        rtt = []
        for _ in range(20):
            t = time.perf_counter()
            store.collection.document("no-such-record").get()
            rtt.append(time.perf_counter() - t)
        for q in queries[:5]:  # warm the connection and the index
            store.search(qvecs[q], k=5)
        times = []
        order = [q for _ in range(rounds) for q in queries]
        for q in order:
            t = time.perf_counter()
            store.search(qvecs[q], k=5)
            times.append(time.perf_counter() - t)
        acc = accuracy(store, spec, qvecs, s.match_threshold)
        row = {
            "size": size,
            "collection": name,
            "count": count,
            "latency_ms": _summary_ms(times),
            "doc_get_ms": _summary_ms(rtt),
            **{k: v for k, v in acc.items()},
        }
        results.append(row)
        lat = row["latency_ms"]
        print(
            f"{name} ({count} docs): p50 {lat['p50']:.0f} ms, p95 {lat['p95']:.0f} ms, "
            f"p99 {lat['p99']:.0f} ms (get-by-id p50 {row['doc_get_ms']['p50']:.0f} ms); "
            f"top1 {acc['top1']}/{acc['n_cases']}, top3 {acc['top3']}, top5 {acc['top5']}; "
            f"negatives with a candidate {acc['negatives_with_candidate']}/{acc['n_negatives']}",
            flush=True,
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "embedding_model": s.embedding_model,
        "embedding_dim": s.embedding_dim,
        "match_threshold": s.match_threshold,
        "k": 5,
        "queries": len(queries),
        "rounds": rounds,
        # Where the client ran matters: every search crosses the internet to the database.
        "client": f"{platform.system()} {platform.machine()} laptop in India over the "
        "internet, calling Firestore in asia-south1 (Mumbai)",
        "product_codes": {c: label for c, (label, _) in PRODUCT_CODES.items()},
        "sizes": results,
    }
    path = OUT_DIR / f"{RESULT_NAME}.json"
    path.write_text(json.dumps(out, indent=1, default=str))
    print(f"wrote {path.relative_to(ROOT_DIR)}")


# --- decide: what the app would tell the manager, with the Gemini check ---


def decide(sizes: list[int]) -> None:
    """Run the eval's reports through the live agent's steps against chosen sizes.

    Same steps as `make eval` part 1 (Gemini structures the report, search k=5, the
    MATCH_THRESHOLD cut, then Gemini checks each candidate), only the store is a scale
    collection. "Right" is strict: the first record shown must be one the eval lists.
    """
    from app.agent import tools
    from app.llm import GeminiLLM
    from scripts.eval_retrieval import score_outcomes, shown_matches

    s = get_settings()
    spec = json.loads(CASES_PATH.read_text())
    cases, negatives = spec["cases"], spec["negatives"]
    queries = [c["query"] for c in cases] + [n["query"] for n in negatives]
    results = {}
    for size in sizes:
        name = collection_name(size)
        deps = tools.AgentDeps(
            settings=s, store=scale_store(name), embedder=GeminiEmbedder(s), llm=GeminiLLM(s)
        )
        with ThreadPoolExecutor(max_workers=6) as pool:
            shown = list(pool.map(lambda q, d=deps: shown_matches(q, d), queries))
        before = score_outcomes(cases, negatives, [r[0] for r in shown])
        after = score_outcomes(cases, negatives, [r[1] for r in shown])

        def brief(outcome: dict) -> dict:
            return {
                "right": outcome["right"],
                "missed": outcome["missed"],
                "wrong_shown": outcome["wrong_shown"],
                "false_alarms": len(outcome["alarms"]),
                "look_alike_alarms": outcome["look_alike_alarms"],
            }

        results[name] = {
            "size": size,
            "score_only": brief(before),
            "with_check": brief(after),
            "n_cases": len(cases),
            "n_negatives": len(negatives),
            "shown": {
                q_id: {"by_score": r[0], "after_check": r[1], "best": round(r[2], 4)}
                for q_id, r in zip(
                    [c["id"] for c in cases] + [n["id"] for n in negatives], shown, strict=True
                )
            },
        }
        b, a = results[name]["score_only"], results[name]["with_check"]
        print(
            f"{name}: right {b['right']} -> {a['right']}/{len(cases)}, "
            f"wrong shown {b['wrong_shown']} -> {a['wrong_shown']}, "
            f"false alarms {b['false_alarms']} -> {a['false_alarms']}/{len(negatives)}",
            flush=True,
        )
    path = OUT_DIR / f"{RESULT_NAME}_decide.json"
    path.write_text(json.dumps({"gemini_model": s.gemini_model, "results": results}, indent=1))
    print(f"wrote {path.relative_to(ROOT_DIR)}")


# --- chart ---


def chart() -> None:
    from scripts.benchmark_report import AQUA, BLUE, INK, ORANGE, SURFACE, _style

    data = json.loads((OUT_DIR / f"{RESULT_NAME}.json").read_text())
    rows = sorted(data["sizes"], key=lambda r: r["count"])
    plt = _style()
    fig, (left, right) = plt.subplots(1, 2, figsize=(10, 4.2))
    fig.subplots_adjust(left=0.08, right=0.95, bottom=0.16, top=0.88, wspace=0.42)
    x = list(range(len(rows)))
    labels = [f"{r['count']:,}" for r in rows]

    for key, color, label in (
        ("p50", BLUE, "median"),
        ("p95", ORANGE, "95th percentile"),
        ("p99", INK, "99th percentile"),
    ):
        y = [r["latency_ms"][key] for r in rows]
        left.plot(x, y, color=color, lw=2, marker="o", ms=7, label=label, mec=SURFACE, mew=2)
        left.text(x[-1] + 0.12, y[-1], f"{y[-1]:.0f} ms", va="center", color=INK, fontsize=10)
    left.set_xticks(x, labels)
    left.set_xlim(-0.3, x[-1] + 0.75)
    left.set_ylim(0, max(r["latency_ms"]["p99"] for r in rows) * 1.2)
    left.set_xlabel("past repairs in memory")
    left.set_ylabel("ms per search (k=5)")
    left.legend(frameon=False, loc="upper left", fontsize=9)
    left.set_title("Search time as memory grows")

    n = rows[0]["n_cases"]
    series = (
        ("top5", ORANGE, "in the 5 results"),
        ("top3", AQUA, "in the first 3"),
        ("top1", BLUE, "first"),
    )
    for key, color, label in series:
        y = [r[key] for r in rows]
        right.plot(x, y, color=color, lw=2, marker="o", ms=7, label=label, mec=SURFACE, mew=2)
        right.text(x[-1] + 0.12, y[-1], f"{y[-1]}", va="center", color=INK, fontsize=10)
    right.set_xticks(x, labels)
    right.set_xlim(-0.3, x[-1] + 0.5)
    right.set_ylim(0, n + 1)
    right.set_yticks(range(0, n + 1, 2))
    right.set_xlabel("past repairs in memory")
    right.set_ylabel(f"test reports (of {n}) whose own record is")
    right.legend(frameon=False, loc="lower left", fontsize=9)
    right.set_title("Still finding the demo's records")

    path = OUT_DIR / "scale.png"
    fig.savefig(path)
    plt.close(fig)
    print(f"wrote {path.relative_to(ROOT_DIR)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="step", required=True)
    sub.add_parser("fetch", help="download reports from openFDA")
    sub.add_parser("indexes", help="create a vector index on each scale collection")
    p_load = sub.add_parser("load", help="embed and write the scale collections")
    p_load.add_argument("--max-usd", type=float, default=5.0, help="stop if the estimate is over")
    p_load.add_argument("--queries", type=int, default=425, help="for the read estimate")
    p_run = sub.add_parser("run", help="measure latency and accuracy per size")
    p_run.add_argument("--rounds", type=int, default=2, help="times each query is timed")
    p_run.add_argument("--extra", type=int, default=175, help="held-out real reports as queries")
    p_decide = sub.add_parser("decide", help="the eval with the Gemini check, per size")
    p_decide.add_argument("--sizes", type=int, nargs="+", default=[SIZES[0], SIZES[-1]])
    sub.add_parser("chart", help="draw docs/benchmark/scale.png")
    args = parser.parse_args()

    if args.step == "fetch":
        fetch()
    elif args.step == "indexes":
        indexes()
    elif args.step == "load":
        load(args.max_usd, args.queries)
    elif args.step == "run":
        run(args.rounds, args.extra)
    elif args.step == "decide":
        decide(args.sizes)
    elif args.step == "chart":
        chart()


if __name__ == "__main__":
    main()
