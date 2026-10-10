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
