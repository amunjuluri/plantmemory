# Design decisions

Short log of choices and why. Newest last.

1. **uv + Python 3.13** instead of pip/requirements.txt and 3.12. uv installs Python,
   resolves and locks deps (`uv.lock`) in one fast tool, and the same lock is used in
   the Docker image. 3.13 is the newest version every dependency (ADK, Firestore,
   numpy) ships wheels for.
2. **Model names from current docs (2026-10-10):** `gemini-3.8-flash` (Google's
   recommended Flash model for new projects) and `gemini-embedding-2` (current
   recommended embedding model, multimodal). Both are env-configurable.
3. **Embedding dimension 768.** Firestore vector indexes allow at most 2048 dimensions;
   `gemini-embedding-2` renormalises truncated vectors itself, and 768 is one of the
   sizes Google recommends.
4. **`gemini-embedding-2` has no `task_type` parameter.** Query vs document intent is
   expressed with prompt prefixes instead, per the embeddings docs.
5. **Vertex AI location defaults to `global`.** Newer Gemini models are served from the
   global endpoint; Cloud Run itself is deployed to a regional location.
6. **Frontend: Next.js static export, served by FastAPI.** The brief asked for Next.js
   but also "no build step / no framework", which conflict. We keep one deployable
   service: Next.js is built to static files in a Docker build stage and FastAPI
   serves them. Until the UI phase, FastAPI serves a placeholder from `app/static`.
7. **Embedding kept off API responses** via a separate `IncidentPublic` response model;
   `IncidentRecord` (stored form) adds the `embedding` field.
8. **Draft items carry their own citations.** Each suggested check/action is a
   `DraftItem` with `citations` and a `general` flag, so code can verify every claim
   cites only ids returned by search, and general advice is labelled as such.
9. **`gemini-embedding-2` embeds one content per request on Vertex AI.** Passing a
   list of strings returns a single vector (it is treated as one multi-part input), and
   a list of `Content` objects is rejected. `GeminiEmbedder` therefore sends one request
   per text, 8 in parallel, and checks the vector count. `gemini-embedding-001` still
   uses batched requests with `task_type`.
10. **Keyword baseline is BM25**, not raw word overlap, so the semantic-vs-keyword
    comparison is against the standard text-search method rather than a weak one.
11. **`MATCH_THRESHOLD=0.70`.** On the seed data the weakest true top match scored
    0.731 and unrelated queries (forklift charger, coffee machine) scored up to 0.662.
    The margin is narrow; re-run `make eval` after changing data or models.
12. **Store method is `list_records`, not `list`.** A method named `list` shadows the
    builtin inside the class body and breaks `list[...]` annotations.
13. **Agent: ADK `Agent` (LlmAgent) with four function tools, results passed through
    session state.** The model orders the calls, but it never re-types a match list or
    score between steps: each tool reads the previous step's output from state and
    refuses to run before it. The core logic lives in plain functions in
    `app/agent/tools.py` with the signatures from the brief, so it is testable without
    ADK. ADK 2.x also offers a graph `Workflow`, which would make the order fixed and
    save about 8 s of orchestration turns; kept as an option if latency matters more.
14. **Citations are inline `[RECORD-ID]` markers plus per-item `citations` lists.**
    Code rejects any id that is not among the matches the search returned *and* that
    pass the relevance rule below (stricter than "returned by search"). The model gets
    one retry with the offending ids named; a second violation fails the request.
    `/approve` re-checks every id, including ones a reviewer typed into the edited
    text, against the store.
15. **An uncited suggestion is always labelled general**, whatever the model says, so
    the UI can show which advice comes from plant history and which does not.
16. **`MATCH_MARGIN=0.06`.** Live runs showed that different problems on the same
    machine score ~0.79, above `MATCH_THRESHOLD`, which inflated repeat counts. On the
    eval set, every true second match scored within 0.06 of the best match; only 2 of
    8 wrong neighbours did. A match now counts as the same problem only if it passes
    both the threshold and the margin.
17. **Recurrence is computed in code, not by the model**: counts of same-problem
    records within `RECURRENCE_WINDOW_MONTHS` before the incident, and records whose
    fix has outcome `recurred`. Shallow-cause flags ("operator error", "retrained",
    "SOP not followed") are also regex rules in code, with the prompt asking the model
    to address them too.
18. **Gemini 3.x settings:** temperature left at the default (Google advises against
    lowering it on Gemini 3); `thinking_level` instead of `thinking_budget`.
    `gemini-3.8-flash` rejects `minimal`. Drafting at `low` takes ~9 s versus ~16 s at
    `medium` with similar quality on the seed data; set via `DRAFT_THINKING_LEVEL`.
19. **`GOOGLE_GENAI_USE_ENTERPRISE` replaces `GOOGLE_GENAI_USE_VERTEXAI`**, which
    current google-genai and ADK report as deprecated. Both names are still accepted.
20. **Streaming endpoint via FastAPI's native SSE** (`fastapi.sse`), so the UI can show
    each agent step as it happens. After `draft_report` succeeds the tool sets
    `skip_summarization`, ending the turn without an extra model call.
21. **The model's paraphrase never replaces the incident description**: the stored
    `description` is always the user's original text.
