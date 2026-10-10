# Progress log

Where PlantMemory stands, what's next, and the dates that matter. Updated at the end of
every phase. Design choices live in [DECISIONS.md](DECISIONS.md); step-by-step test
instructions are in the shared testing guide.

**Deadline:** prototype submitted before **18 Oct 2026** (Google Cloud AI Builder Cup,
APAC). **16 and 17 Oct are reserved** for docs, the deck and the 3-minute demo video. If
anything runs late, cut scope, not the video.

## Phases

| Phase | Status | Finished | Result |
|---|---|---|---|
| 0. Environment | Done | 10 Oct | GCP project `plantmemory-tqot45`, region `asia-south1`, Vertex AI via ADC |
| 1. Skeleton | Done | 10 Oct | FastAPI, settings, models, Makefile, `/health` |
| 2. Retrieval | Done | 10 Oct | Semantic top-1 **8/8** vs keyword (BM25) 5/8; 4/4 on low-keyword queries |
| 3. Agent | Done | 10 Oct | ADK agent, 4 tools; citation, no-match and shallow-cause rules enforced in code |
| 4. Logbook photo | Done | 10 Oct | Handwritten page to reviewed records; unreadable words flagged, never guessed |
| 5. UI | Done | 10 Oct | Analyze, Digitize logbook, Memory; desktop and phone; light and dark |
| 6. Cloud | Done | 10 Oct | Live at https://plantmemory-4l5hbd2imq-el.a.run.app (Cloud Run + Firestore vector search, `asia-south1`) |
| 7. Docs | Not started | | README, architecture, data notice, eval results |

## After Phase 6, in priority order

Agreed on 10 Oct after an outside review of the plan. The goal is to stop this reading
as "another document chatbot": the story is repeat failures, lost knowledge, and fixes
that didn't hold.

1. **Done 10 Oct. Cost of the repeat, in the app.** The amber banner says e.g. "3rd time in 12
   months: 2 h 10 min of downtime in this sample plant". The downtime field already
   exists, so this is small. Figures are always labelled as sample data, never as
   industry facts.
2. **Done 10 Oct. A more convincing eval.** Grow the synthetic set to about 40 to 60 incidents,
   including look-alikes that should *not* match. Report the false-alarm rate ("said it
   happened before when it hadn't") alongside the hit rate.
3. **Matching across languages.** A new incident written in a regional language mixed
   with English shorthand finds a past incident written in English. Add 1 or 2 such
   queries to the eval so it's evidence, not a one-off demo. Use only a language
   someone on the team can read and check (**to decide: which language**).
   Hand-written sample pages beat generated ones if we can make them.
4. **Stretch, only if 1 to 3 are done by 15 Oct:** a weekly "keeps coming back" view
   that lists recurring problem groups whose fixes didn't hold, without anyone
   searching.

**Pitch line (draft):** "Plants don't lack data, they lose memory. PlantMemory catches
a problem that's happened before, even when it was written differently, on paper, by
another shift, and warns you when last time's fix didn't work."

## Log

- **10 Oct.** Phases 0 to 5 done. UI built on Next.js 16 + Base UI, following Emil
  Kowalski's design skills (vendored in `.claude/skills/`). Local ports moved to 8473
  (API) and 3473 (UI dev). Co-author lines removed from all commit messages; rule: no
  co-authors on any commit.
- **10 Oct.** Phase 6 code: FirestoreStore (vector search), 3-stage Dockerfile
  (production image tested locally end to end), idempotent `scripts/deploy.sh` with
  least-privilege service accounts, per-visitor AI rate limit. Waiting for approval
  to create cloud resources.
- **10 Oct.** Phase 6 deployed: https://plantmemory-4l5hbd2imq-el.a.run.app. Firestore
  database, 3 indexes, 2 service accounts and the 12 synthetic incidents created by
  `make deploy SEED=1`. Live check: a PM2 sheet-break report finds PAP-0002 (0.89) and
  PAP-0001 (0.85), the same as locally. Note: the default gcloud account on this Mac
  is a different project's service account; deploys use the `plantmemory` gcloud
  configuration, so always go through `make deploy`.
- **10 Oct.** Roadmap item 1 done: the repeat banner leads with "3rd time in 12
  months" and "2 h 45 min of downtime so far", computed in code from the matched
  records (never by the model). 80 tests pass.
- **10 Oct.** Checked the concern that memory would vanish on Cloud Run: it doesn't.
  All records live in Firestore, not on the container's disk. Proved it live:
  approved a test record, read it straight from Firestore, forced two restarts, still
  there; then deleted it (memory back to the 12 samples).
- **10 Oct.** Live testing found Gemini sometimes busy (429) or slow (one call took
  100 s), which showed up as "Internal Server Error". Fixed: retries with backoff,
  per-call timeouts, and a plain "Gemini is busy, try again in a minute" message.
  Deployed; live runs take 15 to 20 s. 84 tests pass. **Before recording the demo
  video, run one analysis first** so the instance is warm.
- **10 Oct.** Roadmap item 2 done. Memory grew from 12 to 44 synthetic incidents
  (new problem types written twice in different styles, plus deliberate look-alikes);
  tests grew from 10 to 46 reports (30 that should match, 16 that should not, 13 of
  them look-alikes). The bigger eval exposed a real flaw: scores alone gave **15/16
  false alarms**. Added a Gemini check of each candidate: now **0/16 false alarms,
  30/30 right, 0 wrong records shown**, the same across three runs. Demo examples
  unchanged. Details in [EVAL_RESULTS.md](EVAL_RESULTS.md). Also fixed a race where
  parallel first requests could close the shared Gemini connection. 87 tests pass.
  Suggestion for the team: write ~10 test reports of your own as a held-out check.

