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
16. **`MATCH_MARGIN=0.06`** (replaced by 40). Live runs showed that different problems on the same
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
38. **All plant memory lives in Firestore on Cloud Run**, never on the container's
    disk: seed records, approved drafts and confirmed logbook records all go through
    `FirestoreStore`. Record ids are random (`APR-`/`LOG-` + 8 hex), so several
    instances can write at once without clashing. Verified live on 10 Oct: an
    approved record was readable directly from Firestore and survived two forced
    restarts (new revisions), then was deleted.
39. **Gemini calls retry when busy or slow.** 429/503/5xx and timeouts are retried
    3 times with backoff (about 2, 4, 8 s). Each agent call times out at 30 s,
    other calls (logbook photos) at 90 s. If it still fails, the user sees "Gemini is
    busy right now. Please try again in a minute." (503 outside the agent), never a
    bare 500. Found during live testing: one 429 and one 100 s first call.
40. **Gemini checks every search candidate before it is shown** (replaces 16, the
    `MATCH_MARGIN` rule). With 44 records, scores alone could not tell a true repeat
    from "same machine, different problem": the app said "this happened before" for
    15 of 16 new problems. Now records scoring at least `MATCH_THRESHOLD` (0.70) are
    candidates, one Gemini call judges each against the new report, and code keeps
    only confirmed candidate ids (the model can remove, never add). Result: 0 of 16
    false alarms, 30 of 30 right, at the cost of about 3 s per analysis. The prompt
    states general rules only and names no test case.
41. **The eval measures what the user sees**, not just search ranking: each test
    report runs through the same steps as the live agent, and we report right
    answers, wrong records shown, misses and false alarms. Labels in
    `retrieval_cases.json` were not changed after seeing results, even where the
    check's answer is arguable (Q4, Q7).

42. **The user is the maintenance manager, not the worker** (12 Oct). Workers in pharma
    plants usually can't carry phones on the floor and wait for the manager's
    instruction after escalating a breakdown. So the product drafts a repair guide for
    the manager, QA approves it, and the workers get a printed controlled copy in their
    language. The repeat-failure memory stays, as a warning inside the guide.
43. **The guide pipeline is a fixed sequence, not an agent loop.** Understand the report,
    then search past fixes and manuals side by side, then parts, then write. The order
    never changes, so a model choosing it adds latency and risk; running the two
    searches in parallel saves several seconds. The incident analysis agent (ADK) is
    unchanged and still used by the eval.
44. **Manual sections are cited as `MAN-<manual>-<page>`**, alongside incident ids, and
    pass through the same citation check. Alarm codes link to the section that explains
    them, not to the alarm list page that only names them.
45. **Values with units must be in a cited source.** Code extracts number-plus-unit pairs
    (including ranges like "8 to 10 mm") from each line and from the sources it cites;
    any value not found is flagged for the manager and QA. Flags rather than rejection,
    so a manager can deliberately add a value, but QA sees it.
46. **Parts, stock and time are looked up in code.** The model may only pick part numbers
    from the store's list for that machine; quantities are checked against stock, and
    out-of-stock or last-in-store parts become warnings with the lead time. The time
    estimate is the manual's typical time for the cited procedure plus the median of
    past downtimes for confirmed matches.
47. **Translation happens when the guide is sent to QA**, so QA approves exactly what will
    be printed. Code checks each translated line keeps every number (Indian-script digits
    are normalised), part number, alarm code and machine tag; failures are shown to QA.
    Languages come from `GUIDE_LANGUAGES` (default Telugu and Hindi). Section headings
    on the printed sheet are fixed strings, never model output.
48. **QA approval rules in code**: the submitter cannot approve or reject their own guide
    (names compared case-insensitively), a rejection needs a reason, only approved guides
    print, every print increments a copy number in the audit trail, and approved guides
    can't be edited. The demo has no sign-in, so the acting person picks a role and name;
    this is not a 21 CFR Part 11 e-signature and is not presented as one.
49. **Voice intake is stateless and code decides when it is complete.** Gemini hears the
    audio (any language), fills English fields and asks for what is missing in the
    manager's language; required fields are fixed per mode in code, and a symptom such
    as "stopped" or "not working" does not count. The conversation stops after 5 turns.
    The summary keeps the manager's own words, so a Telugu report still finds English
    records by meaning (verified: a Telugu autoclave report found PHA-0028).
50. **Machine logs: tables are parsed in code, everything else by Gemini.** Exported alarm
    tables (WinCC-style `Date;Time;Number;Class;State;Text`) are parsed deterministically;
    unknown formats (controller printouts) go to Gemini, last 300 lines. What a code means,
    whether it stops the machine and the first actions come from the manual's alarm
    table, never from the model. A warning whose manual section names an error that
    appears in the same log is linked to it ("often comes before E-104").
51. **CMMS import: Gemini maps columns, code copies rows.** The model sees the header and
    four rows and names which columns hold date, machine, description, cause, action,
    downtime (and unit) and status. Code drops any column it invented and applies the
    mapping to every row, so nothing is paraphrased. Rows come back for review like
    logbook pages and are saved as `CMMS-<notification>` records. SAP PM is the sample
    because that is what the plant we spoke to uses; live SAP (`API_MAINTNOTIFICATION`)
    or Maximo (OSLC `mxwo`) connectors are future work.
52. **Manual PDFs: Gemini reads text and figure boxes; code cuts the figures.** Pages are
    rendered with pdfium and each figure box is cropped, so a guide shows the manual's
    own drawing, never a generated one. Figures are stored as base64 in Firestore
    (one document each, under 1 MiB), so no Cloud Storage bucket or extra IAM is needed.
53. **Synthetic manual figures are drawn by Gemini's image model** from invented
    descriptions (`scripts/make_figures.py`), as black-on-white line drawings, because no
    real manual may be copied. They are labelled synthetic like all other data.
54. **Slow Gemini calls are hedged.** The same translation request took 8 s, 54 s and
    101 s in three tries with identical output size. If a translation, guide or voice
    turn has not answered within 15 s, 20 s or 10 s, the same request is sent again
    (at most three copies) and the first answer wins. Measured: three full Telugu and
    Hindi translations took 13, 18 and 30 s instead of up to 100 s.
55. **The knowledge base uses one small document store per kind** (local JSON or one
    Firestore collection each): manual sections, alarm codes, parts, figures, guides.
    Only manual sections need a vector index; other lookups are equality filters.
56. **Per-client AI limit raised from 40 to 120 requests an hour** on Cloud Run: one
    breakdown now uses several AI requests (voice turns, guide, translation).
57. **Voice is a live conversation on Gemini Live.** The turn-based voice read questions
    with the browser's speech synthesis, which sounded robotic and missing for some
    languages. Now the browser streams 16 kHz PCM over a WebSocket (`/api/intake/live`)
    to `gemini-3.8-live`, and its native audio replies stream back: first audio about 0.7 s
    after the manager stops talking, and they can interrupt. On Vertex AI the Live model
    is served from `us-central1` (not `global` or `asia-south1`; probed 12 Oct), so voice
    audio leaves India while the rest stays in `asia-south1`. The model fills the report
    only through an `update_report` tool; code merges, normalises spoken tags ("TP one" ->
    TP-01), decides what is missing and accepts `confirm_report` only when nothing is.
    Sessions end after 8 minutes; Cloud Run's request timeout is 600 s. The browser's
    Origin must be this site. The old `/api/intake/turn` endpoint stays for clients that
    can't stream audio.
58. **Closing a breakdown by voice uses the guide.** The model gets the guide's steps,
    parts and the time since it was drafted, so "did what the guide said" becomes
    "Followed guide GDE-…: <steps>", downtime can be offered from the elapsed time, and
    "upper punch" becomes RTP-PN-U-10. Code refuses a bare "did it / as per guide" and,
    when the guide listed parts, requires an answer on which were used ("None" is fine).
    The form fills while they talk; the manager still presses Save.
59. **The manager approves guides; QA approves only when code finds a reason.** The
    plant contact said QA approves, but research found no rule that QA pre-approves every
    breakdown repair. GMP practice: maintenance restores the qualified state under an
    engineering work order; QA comes in through change control (anything not
    like-for-like), deviations (product impact) and line clearance before production
    restarts. The EU draft GMP Annex 22 allows generative AI only in non-critical use
    with a qualified person reviewing every output, which is the manager here. So QA must
    approve when the guide holds something not from the plant's sources: a flagged value,
    a step with no source, no manual match, a translation flag, or an earlier rejection
    (`qa_reasons`, computed in code and shown to both). A plant whose SOP says otherwise
    sets `QA_APPROVAL=always`. Making QA approve every guide would add QA's queue time to
    every breakdown's downtime.
60. **QA releases the machine to production after the repair.** New status `released`
    after `closed`: QA ticks three line-clearance checks (cleaned, tools and old parts
    removed, line clearance done); the person who closed the repair can't release it. The
    printed sheet gains a "Line clearance by QA" sign-off box.
61. **Manual citations read "Manual p.16", not "RTP37 p.16".** A manager who said TP-01
    saw "RTP37" and thought the app had picked another machine; RTP-37 is TP-01's model.
    The sources list now says "Manual: Kestrel RTP-37 rotary tablet press, the model of
    TP-01 and TP-02".
62. **The synthetic-data label belongs to the data, not the app.** It is in the demo
    manuals' titles, the header chip and the printed footer only when the guide's manual
    is synthetic. A plant that loads its own manuals and records sees no such label. It
    stays on the demo data, because an invented torque or temperature on a printed sheet
    must never be mistaken for a real manual's.
