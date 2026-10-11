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
| 8. Manager pivot | Done | 12 Oct | Repair guides, QA approval, Telugu/Hindi print, voice intake, alarm logs, SAP import, manual upload |
| 7. Docs | Started | | README rewritten for the manager story; architecture and deck still to do |

## Phase 8: built for the maintenance manager (12 Oct)

Why: a relative who works in pharma said workers usually can't carry phones on the floor.
After a breakdown they escalate and wait for the manager's instruction, and breakdown
logs exist but are hard to use. So the user is the manager (and QA), and the workers get
a printed sheet. See DECISIONS 42 to 56.

What was built:

1. **Easier input.** Voice in any language, with the app asking for what's missing
   (Telugu audio → "TP-02, E104, stopped" in 5 s); logbook photos; SAP PM / CMMS exports
   (CSV or Excel, Gemini maps the columns, code copies every row); manual PDFs (Gemini
   reads pages and the alarm table, code cuts out the figures).
2. **Repair guide for the manager.** Past fixes + the manual's procedure + parts with stock
   + time estimate, every line cited, values not in a source flagged. QA approves (not the
   submitter), translated into Telugu and Hindi on the way, printed as an A4 controlled
   copy with figures, tick boxes and sign-off lines. Closing it saves what was done.
3. **Machine logs.** HMI alarm exports parsed in code, other formats by Gemini; errors that
   stopped the machine first with the manual's first actions, time from manual and
   history, past fixes; rising warnings linked to the error they precede. One click to a
   guide.

Synthetic knowledge base: manuals for TP-01/02 (tablet press), BL-3 (blister line) and
AC-2 (autoclave), 21 alarm codes, 23 parts, 16 figures drawn with Gemini; 8 new breakdown
incidents (52 total); samples for every input. Eval re-run with 52 incidents: unchanged
(30/30 right, 0 wrong records shown, 0/16 false alarms). 141 tests.

Still to decide or do:
- Ask the pharma contact to check the Telugu on a printed sheet (headings are fixed text
  in `print-sheet.tsx`; step text is translated by Gemini and checked for numbers/codes).
- Languages are one setting (`GUIDE_LANGUAGES`) if the plant needs others.
- Live SAP or Maximo connectors are future work; the demo imports an IW29 export.

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
3. **Matching across languages.** Partly done 12 Oct: a Telugu autoclave report finds the
   English record PHA-0028 and the autoclave manual, and voice intake keeps the manager's own
   words. Telugu chosen (the team can read it). Still to do: add 1 or 2 Telugu queries
   to the eval so it's measured, not a one-off.
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
- **10 Oct.** Deployed with the 44 incidents in Firestore. Live check: sheet breaks
  (3rd time, 2 h 45 min), settle plate (2nd time, fix did not hold), forklift (no
  match) and a PM2 hydraulic-leak look-alike (no match) all correct; 12 to 26 s each
  once warm, 46 s for the first request after a deploy.

- **12 Oct.** Phase 8 (manager pivot) built and tested end to end in the browser: TP-02
  E-104 guide in 17 to 31 s (3rd time in 12 months, cleaning alone did not hold, bushing
  RTP-BS-07 last one in store), sent to QA with Telugu and Hindi, approved by a different
  person, printed to PDF (5 A4 pages, three languages, manual figures). Found and fixed:
  Gemini answering the same translation in 8 s or 101 s (now hedged: 13 to 30 s), a
  spoken "machine stopped" counting as a symptom, alarm codes linking to the alarm list
  page instead of the procedure. Eval unchanged with 52 incidents.
