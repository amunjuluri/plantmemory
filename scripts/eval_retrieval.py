"""Measure retrieval quality: semantic search vs a keyword (BM25) baseline.

Prints top-1 and top-3 hit rates for both, a per-query table, and the similarity
scores of queries that should match nothing (to help set MATCH_THRESHOLD).

Usage: uv run python -m scripts.eval_retrieval   (run scripts.seed first)
"""

import json
import math
import re
import sys
from collections import Counter

from app.config import ROOT_DIR, get_settings
from app.embeddings import GeminiEmbedder, incident_text
from app.models import IncidentRecord
from app.store import get_store

CASES_PATH = ROOT_DIR / "data" / "eval" / "retrieval_cases.json"

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


def main() -> None:
    settings = get_settings()
    store = get_store()
    total = store.count()
    if total == 0:
        sys.exit("Store is empty. Run `make seed` first.")

    records: list[IncidentRecord] = store.list_records(limit=total)
    texts = {r.id: incident_text(r) for r in records}
    bm25 = BM25(texts)
    embedder = GeminiEmbedder(settings)
    spec = json.loads(CASES_PATH.read_text())

    rows = []
    positive_scores = []
    for case in spec["cases"]:
        expected = set(case["expected"])
        hits = store.search(embedder.embed_query(case["query"]), k=3)
        sem_ids = [h.record.id for h in hits]
        kw_ids = [doc_id for doc_id, _ in bm25.search(case["query"], k=3)]
        positive_scores.append(hits[0].score)
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

    n = len(rows)
    print(f"\nRetrieval eval: {n} queries over {total} records")
    print(f"Embedding model: {settings.embedding_model} ({settings.embedding_dim} dims)\n")
    print("| Query | Word overlap | Low-keyword | Semantic top 3 | Top score | Keyword top 3 |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        print(
            f"| {r['id']} | {r['overlap']:.0%} | {'yes' if r['low_keyword'] else ''} "
            f"| {', '.join(r['sem_ids'])} | {r['score']:.3f} "
            f"| {', '.join(r['kw_ids']) or '(none)'} |"
        )

    def rate(key: str, subset: list[dict]) -> str:
        hits = sum(r[key] for r in subset)
        return f"{hits}/{len(subset)} ({hits / len(subset):.0%})"

    low = [r for r in rows if r["low_keyword"]]
    print("\n| Method | Top-1 hit rate | Top-3 hit rate | Top-1 on low-keyword queries |")
    print("|---|---|---|---|")
    print(
        f"| Semantic ({settings.embedding_model}) | {rate('sem1', rows)} | {rate('sem3', rows)} "
        f"| {rate('sem1', low)} |"
    )
    print(f"| Keyword (BM25) | {rate('kw1', rows)} | {rate('kw3', rows)} | {rate('kw1', low)} |")

    negatives = spec.get("negatives", [])
    if negatives:
        print("\nQueries with no true match (best similarity score):")
        neg_scores = []
        for case in negatives:
            best = store.search(embedder.embed_query(case["query"]), k=1)[0]
            neg_scores.append(best.score)
            print(f"  {case['id']}: {best.score:.3f} ({best.record.id})  {case['query']}")
        print(
            f"\nLowest true-match top score: {min(positive_scores):.3f}. "
            f"Highest no-match score: {max(neg_scores):.3f}. "
            f"Current MATCH_THRESHOLD: {settings.match_threshold}"
        )


if __name__ == "__main__":
    main()
