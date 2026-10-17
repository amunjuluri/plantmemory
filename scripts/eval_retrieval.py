"""Measure how well PlantMemory recognises a problem that has happened before.

Two parts:
1. Search quality: semantic search vs a keyword (BM25) baseline, top-1 and top-3 hit
   rates on the raw test reports.
2. What the app tells the user: each report goes through the same steps as the live
   agent (Gemini structures it, search, MATCH_THRESHOLD, then Gemini checks each
   candidate). We count right answers, wrong records shown, misses, and false alarms
   (saying "this happened before" for a problem that is not in memory), with and
   without the Gemini check.

Usage: uv run python -m scripts.eval_retrieval [--out docs/EVAL_RESULTS.md]
(run `make seed` first)
"""

import argparse
import json
import math
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from app.agent import tools
from app.config import ROOT_DIR, get_settings
from app.embeddings import incident_text
from app.models import IncidentRecord

CASES_PATH = ROOT_DIR / "data" / "eval" / "retrieval_cases.json"
_PARALLEL = 6

_STOPWORDS = set(
    "a an and are as at be been before by for from has have in into is it its of off on or "
    "our out over so that the their them there they this to up was were will with".split()
)


def tokenize(text: str) -> list[str]:
    """Lower-case word tokens without stopwords."""
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS]


class BM25:
    """Plain BM25 keyword ranking, the usual baseline for text search."""

    def __init__(self, docs: dict[str, str], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.tokens = {doc_id: tokenize(text) for doc_id, text in docs.items()}
        self.avg_len = sum(len(t) for t in self.tokens.values()) / max(len(self.tokens), 1)
        df = Counter(term for toks in self.tokens.values() for term in set(toks))
        n = len(self.tokens)
        self.idf = {term: math.log(1 + (n - f + 0.5) / (f + 0.5)) for term, f in df.items()}

    def search(self, query: str, k: int) -> list[tuple[str, float]]:
        """Return the top k (doc id, score) pairs."""
        query_terms = tokenize(query)
        scores = {}
        for doc_id, toks in self.tokens.items():
            tf = Counter(toks)
            norm = self.k1 * (1 - self.b + self.b * len(toks) / self.avg_len)
            scores[doc_id] = sum(
                self.idf.get(t, 0.0) * tf[t] * (self.k1 + 1) / (tf[t] + norm)
                for t in query_terms
                if tf[t]
            )
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        return [(doc_id, s) for doc_id, s in ranked[:k] if s > 0]


def keyword_overlap(query: str, docs: list[str]) -> float:
    """Share of query words that appear in any of the given documents."""
    q = set(tokenize(query))
    d = set(tokenize(" ".join(docs)))
    return len(q & d) / len(q) if q else 0.0


def shown_matches(query: str, deps: tools.AgentDeps) -> tuple[list[str], list[str], float]:
    """Ids shown by score alone, ids shown after the Gemini check, and the best score."""
    incident = tools.structure_incident(query, deps)
    matches = tools.search_similar(incident, deps, k=5)
    by_score = [m.id for m in tools.candidates(matches, deps.settings)]
    verified = [m.id for m in tools.verify_matches(incident, matches, deps)]
    return by_score, verified, (matches[0].score if matches else 0.0)


def pct(hits: int, total: int) -> str:
    return f"{hits}/{total} ({hits / total:.0%})" if total else "n/a"


def search_section(spec: dict, records: list[IncidentRecord], deps: tools.AgentDeps) -> list[str]:
    texts = {r.id: incident_text(r) for r in records}
    bm25 = BM25(texts)
    rows = []
    for case in spec["cases"]:
        expected = set(case["expected"])
        hits = deps.store.search(deps.embedder.embed_query(case["query"]), k=3)
        sem_ids = [h.record.id for h in hits]
        kw_ids = [doc_id for doc_id, _ in bm25.search(case["query"], k=3)]
        rows.append(
            {
                "id": case["id"],
                "low_keyword": case["low_keyword"],
                "overlap": keyword_overlap(case["query"], [texts[i] for i in expected]),
                "sem_ids": sem_ids,
                "score": hits[0].score,
                "kw_ids": kw_ids,
                "sem1": sem_ids[0] in expected,
                "sem3": bool(expected & set(sem_ids)),
                "kw1": bool(kw_ids) and kw_ids[0] in expected,
                "kw3": bool(expected & set(kw_ids)),
            }
        )

    def rate(key: str, subset: list[dict]) -> str:
        return pct(sum(r[key] for r in subset), len(subset))

    low = [r for r in rows if r["low_keyword"]]
    out = [
        "## 2. Search quality: meaning vs keywords",
        "",
        "The raw test report is searched against memory. A hit means a record describing "
        "the same problem is ranked first (top 1) or in the first three (top 3).",
        "",
        "| Method | Top-1 hit rate | Top-3 hit rate | Top-1 on low-keyword reports |",
        "|---|---|---|---|",
        f"| Semantic ({deps.settings.embedding_model}) | {rate('sem1', rows)} "
        f"| {rate('sem3', rows)} | {rate('sem1', low)} |",
        f"| Keyword (BM25) | {rate('kw1', rows)} | {rate('kw3', rows)} | {rate('kw1', low)} |",
        "",
        "<details><summary>Per-report results</summary>",
        "",
        "| Report | Word overlap | Low-keyword | Semantic top 3 | Top score | Keyword top 3 |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        out.append(
            f"| {r['id']} | {r['overlap']:.0%} | {'yes' if r['low_keyword'] else ''} "
            f"| {', '.join(r['sem_ids'])} | {r['score']:.3f} "
            f"| {', '.join(r['kw_ids']) or '(none)'} |"
        )
    out += ["", "</details>", ""]
    return out


def score_outcomes(cases: list[dict], negatives: list[dict], shown: list[list[str]]) -> dict:
    """Right answers, misses, wrong records and false alarms for one way of deciding."""
    pos, neg = shown[: len(cases)], shown[len(cases) :]
    rows = []
    for case, ids in zip(cases, pos, strict=True):
        expected = set(case["expected"])
        extra = [i for i in ids if i not in expected]
        verdict = "missed" if not ids else ("right" if ids[0] in expected else "wrong")
        rows.append((case, ids, verdict, extra))
    # A negative can list records judged to be the same problem (the scale benchmark's
    # judgements); showing one of those first is a find, not a false alarm.
    alarms = [
        (n, ids)
        for n, ids in zip(negatives, neg, strict=True)
        if ids and ids[0] not in n.get("expected", ())
    ]
    return {
        "rows": rows,
        "right": sum(r[2] == "right" for r in rows),
        "all_found": sum(set(r[0]["expected"]) <= set(r[1]) for r in rows),
        "missed": sum(r[2] == "missed" for r in rows),
        "wrong_shown": sum(bool(r[3]) for r in rows),
        "alarms": alarms,
        "look_alike_alarms": sum(n.get("kind") == "look-alike" for n, _ in alarms),
    }


def decision_section(spec: dict, deps: tools.AgentDeps) -> list[str]:
    cases, negatives = spec["cases"], spec["negatives"]
    queries = [c["query"] for c in cases] + [n["query"] for n in negatives]
    with ThreadPoolExecutor(max_workers=_PARALLEL) as pool:
        results = list(pool.map(lambda q: shown_matches(q, deps), queries))
    before = score_outcomes(cases, negatives, [r[0] for r in results])
    after = score_outcomes(cases, negatives, [r[1] for r in results])
    best = [r[2] for r in results]
    n_pos, n_neg = len(cases), len(negatives)
    n_look = sum(n.get("kind") == "look-alike" for n in negatives)

    def line(label: str, key: str, total: int) -> str:
        b = before[key] if isinstance(before[key], int) else len(before[key])
        a = after[key] if isinstance(after[key], int) else len(after[key])
        return f"| {label} | {pct(b, total)} | {pct(a, total)} |"

    out = [
        "## 1. What the app tells the user",
        "",
        "Each report goes through the live agent's steps: Gemini structures it and memory is "
        f"searched. Records scoring at least {deps.settings.match_threshold} are candidates. "
        "The app then asks Gemini to check each candidate and shows only those it confirms "
        "as the same problem; code ignores any id that was not a candidate.",
        "",
        "| Measure | Score only | Score + Gemini check (live) |",
        "|---|---|---|",
        line("Found the right past incident (shown first)", "right", n_pos),
        line("Found every record of the same problem", "all_found", n_pos),
        line("Missed it (said nothing similar)", "missed", n_pos),
        line("Showed at least one wrong record alongside", "wrong_shown", n_pos),
        line("**False alarm**: said it happened before when it had not", "alarms", n_neg),
        line("False alarm on look-alikes", "look_alike_alarms", n_look),
        "",
    ]
    if after["alarms"]:
        out += ["False alarms with the Gemini check:", ""]
        for n, ids in after["alarms"]:
            out.append(f"- {n['id']} showed {', '.join(ids)}: {n['query']}")
        out.append("")
    imperfect = [
        r for r in after["rows"] if r[2] != "right" or r[3] or set(r[0]["expected"]) - set(r[1])
    ]
    if imperfect:
        out += ["Reports not answered perfectly with the Gemini check:", ""]
        for case, ids, verdict, extra in imperfect:
            missing = [i for i in case["expected"] if i not in ids]
            out.append(
                f"- {case['id']} {verdict}; expected {', '.join(case['expected'])}, "
                f"showed {', '.join(ids) or 'nothing'}"
                + (f" (wrong: {', '.join(extra)})" if extra else "")
                + (f" (left out: {', '.join(missing)})" if missing else "")
                + f": {case['query']}"
            )
        out.append("")
    out += [
        "<details><summary>Reports with no true match</summary>",
        "",
        "| Report | Kind | Looks like | Best score | Shown by score only | Shown after check |",
        "|---|---|---|---|---|---|",
    ]
    for i, n in enumerate(negatives):
        b, a = results[n_pos + i][0], results[n_pos + i][1]
        out.append(
            f"| {n['id']} | {n.get('kind', '')} | {n.get('looks_like') or ''} "
            f"| {best[n_pos + i]:.3f} | {', '.join(b) or 'nothing'} | {', '.join(a) or 'nothing'} |"
        )
    out += ["", "</details>", ""]
    return out


def limits(n_reports: int) -> list[str]:
    return [
        "## Limits",
        "",
        "- The records are real public records (FDA device reports, drug recalls and warning "
        "letters, see data/SOURCES.md), rewritten as plant records. The test reports were "
        "written for this project, in English.",
        "- The same team wrote the test reports, chose which records count as the same "
        "problem, and wrote the prompt that checks candidates. The prompt states general "
        "rules and names none of the test cases, but results on reports written by someone "
        "else may be lower. A useful next step is a held-out set written by a plant engineer "
        "who has not seen the prompt.",
        '- "Found every record of the same problem" is strict: `expected` groups every '
        "record with the same symptom, and the Gemini check often keeps only those with the "
        "same cause too.",
        f"- {n_reports} test reports is small: one wrong answer moves a rate by "
        f"{100 / n_reports:.0f} to {100 / 12:.0f} points.",
        "- Gemini's answers vary slightly between runs.",
        "",
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, help="also write the report to this file")
    args = parser.parse_args()

    settings = get_settings()
    deps = tools.get_deps()
    total = deps.store.count()
    if total == 0:
        sys.exit("Store is empty. Run `make seed` first.")
    records = deps.store.list_records(limit=total)
    spec = json.loads(CASES_PATH.read_text())
    n_neg = len(spec["negatives"])
    n_look = sum(n.get("kind") == "look-alike" for n in spec["negatives"])

    out = [
        "# Evaluation results",
        "",
        f"Generated by `make eval` on {date.today().isoformat()}. "
        f"Memory holds {total} real public records; "
        f"{len(spec['cases'])} reports that should find one, {n_neg} that should not, "
        f"{n_look} of them look-alikes). Gemini model `{settings.gemini_model}`, "
        f"embeddings `{settings.embedding_model}` ({settings.embedding_dim} dims).",
        "",
        *decision_section(spec, deps),
        *search_section(spec, records, deps),
        *limits(len(spec["cases"]) + n_neg),
    ]
    text = "\n".join(out)
    print(text)
    if args.out:
        args.out.write_text(text)
        print(f"\nWritten to {args.out}")


if __name__ == "__main__":
    main()
