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
22. **Logbook ingest is two stateless calls.** `/ingest/logbook` returns records with
    `LOG-` ids and saves nothing; `/ingest/confirm` saves whatever the reviewer sends
    back, but only `LOG-` ids, so it cannot overwrite seed or approved records.
    Re-confirming the same ids updates them instead of duplicating.
23. **Abbreviations are expanded in place, in parentheses**, e.g. "PR2 (second press)",
    and only for glossary terms. The writer's words stay, and the expansions help
    meaning-based search. Glossaries are JSON files per industry in `data/glossary/`.
24. **Unsure fields are flagged by the model and by code.** Code drops flag names that
    aren't real fields, flags any field containing an unreadable `[?]`, and flags
    `date` when none was readable (it is filled with today for the reviewer to fix).
25. **Uploads are checked by their bytes, not their name or browser type**: JPEG, PNG,
    WebP, HEIC/HEIF, up to 15 MB (Gemini's inline limit is 20 MB per request). Photos
    are read at `MEDIA_RESOLUTION_HIGH` (`OCR_MEDIA_RESOLUTION`). On both sample pages,
    medium and high read every entry equally well and time per page varied from 7 to
    42 s with no pattern by setting; high is kept as the safer choice for real,
    smaller handwriting.
26. **Sample photos are generated with Gemini's image model** from invented text, so
    tests and the demo never need a real logbook.
27. **UI stack: Next.js 16 static export + Tailwind 4 + Base UI + Sonner + zustand.**
    The static export (`web/out`) is served by FastAPI, so there is still one Cloud
    Run service and no Node server in production. Base UI supplies accessible dialogs,
    the swipeable drawer/bottom sheet, tooltips and toggle groups; Sonner does toasts;
    zustand keeps the analysis alive across tab switches. Picks follow Emil Kowalski's
    `pick-ui-library` list; his design skills are vendored in `.claude/skills/`.
28. **Motion rules from `emil-design-eng`**: strong custom `ease-out`
    (`cubic-bezier(0.23, 1, 0.32, 1)`) instead of the CSS default, UI transitions
    under 300 ms (drawer 400 ms on the iOS drawer curve), transform/opacity only,
    `scale(0.97)` press feedback, hover gated to mouse devices, short staggers on
    result cards, nothing animated on keyboard actions, and a reduced-motion mode that
    keeps fades but drops movement.
29. **Mobile baseline from `mobile-native`**: 16 px inputs (no iOS zoom), `dvh` units,
    safe-area padding with `viewport-fit=cover`, no tap highlight, a bottom tab bar on
    phones, the record viewer as a swipe-down sheet, and camera capture for logbook
    photos. Photos over 1.5 MB are shrunk in the browser to 2400 px JPEG before upload.
30. **UI types are generated from the API** (`make api-types`, openapi-typescript).
    Response models set `json_schema_serialization_defaults_required`, so defaulted
    fields are typed as always present in responses but optional in requests.
31. **The agent's progress streams to the UI** from `/api/incidents/analyze/stream`;
    each finished step carries a one-line `summary` ("2 similar incidents found").
32. **The reviewer's draft survives a refresh** via `sessionStorage` (this tab only),
    restored after mount so it never conflicts with the prerendered HTML.
33. **Local ports 8473 (API) and 3473 (UI dev)**, not 8080/3000, to avoid clashing
    with other local apps. Cloud Run still injects its own `PORT`. CORS is off unless
    `CORS_ORIGINS` is set, and is only needed for `make dev`.
34. **Firestore scores are converted back to cosine similarity** (`1 - COSINE
    distance`), so `MATCH_THRESHOLD` and `MATCH_MARGIN` mean the same on both stores.
    Flat vector indexes (exact search) suit a demo-sized dataset.
35. **Deploy from source with a dedicated build service account** (`run.builder`)
    instead of granting roles to the Compute Engine default account, and a runtime
    service account with only `datastore.user` and `aiplatform.user`.
36. **Three-stage Docker image**: Node builds the UI, a uv stage installs the
    locked dependencies, and the slim runtime holds only the venv, code and synthetic
    data, owned by root and run as an unprivileged user (497 MB uncompressed).
37. **Public demo safety**: per-client limit of 40 AI requests per hour, plus
    `max-instances=3`. The limiter is in memory per instance; good enough for a demo,
    not a substitute for API Gateway or Cloud Armor in production.
