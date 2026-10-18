# PlantMemory: notes for coding agents

PlantMemory helps a plant's maintenance manager, in any industry, get a stopped machine
running again. From a breakdown report it drafts a cited repair guide, the manager checks and
approves it, and the guide is printed for the workers. See [README.md](README.md) for the
product and [docs/TESTING.md](docs/TESTING.md) for every feature, step by step.

## Layout

| Path | What it holds |
|---|---|
| `app/main.py` | FastAPI app: the API, the voice WebSocket, and the built UI from `web/out` |
| `app/guide/` | Guide drafting as an ADK graph Workflow (`flow.py`), the guide builder, guardrails, revisions, translation |
| `app/agent/` | Structuring a report, searching past repairs, the Gemini match check, prompts |
| `app/intake/` | Voice (Gemini Live), alarm logs, SAP CMMS import |
| `app/kb/`, `app/ingest/` | Manuals, alarm codes, parts and figures; logbook photo OCR |
| `app/store/` | Past repairs: `local_store.py` (dev) and `firestore_store.py` (Cloud Run, vector search) |
| `web/` | Next.js UI, built to static files. Read [web/AGENTS.md](web/AGENTS.md) before touching it |
| `scripts/` | Seeding, eval, benchmarks, deploy, the architecture diagram |
| `data/` | Seed repairs, eval cases, stand-in manuals; `data/SOURCES.md` says where each came from |

## Commands

```bash
make install    # Python (uv) and UI (pnpm) dependencies
make dev        # UI with hot reload on :3473, API on :8473
make run        # API + built UI on :8473
make check      # lint, tests and UI typecheck/lint: what CI runs
make fmt        # fix lint and formatting
make api-types  # regenerate web/ types after changing an API model
```

Run `make check` before you call something done. CI fails on `ruff format --check`, so run
`make fmt` after the last edit, including edits to tests.

`make eval`, `make benchmark` (about $2) and `make scale-benchmark` (about $3) call Gemini
and cost money. Ask before running them.

## Rules that come from the plant

- **A human is always in the loop.** The AI drafts; the manager approves. Code, not the
  model, decides when QA must approve a guide, and every step must cite a manual page or
  a past repair returned by search, or be marked "general practice".
- **Never invent part numbers, settings or values.** Parts come from the store and values
  from cited sources; guardrails in `app/agent/guardrails.py` and `app/guide/guardrails.py`
  check this in code.
- **The goal is less downtime.** Records are repair records for faster fixes, not
  recalls or blame.
- **Workflow rules follow real plant practice (GMP where it applies), and are configurable.** Check how plants
  actually do it before choosing a rule, and put the rule in settings (`app/config.py`,
  `.env.example`) instead of hard-coding it.
- **Data must be real and public where possible, and fit a real plant.** No military
  or nuclear sources. Never pitch it as a pharma product: it is for any plant's machines. Plant-private data (stock, bins, people) is invented and says so.
- **OEM manuals:** don't use or commit manuals from LFA, Tuttnauer or Sinda until the
  maker has agreed. Stand-in manuals are written for the demo.
- **Who uses it:** maintenance managers with only a phone, SAP as the CMMS, and printed
  sheets on the floor. Workers read English, Telugu or Hindi, and the floor languages can
  be configured. Expect Telugu-English mixed input.

## Docs

- When behaviour a tester can see changes, update [docs/TESTING.md](docs/TESTING.md) and
  add screenshots under `docs/screenshots/<feature>/`.
- `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/SUBMISSION.md`,
  `docs/MANAGER_FEEDBACK.md`, `docs/BENCHMARK.md` and `docs/EVAL_RESULTS.md` are local
  only (gitignored). Keep them current, but never commit them.
- Benchmark numbers in the README come from a run. Say when it was measured, and never
  edit a number by hand.

## Cloud

- GCP project `plantmemory-tqot45`, region `asia-south1` (Cloud Run, Firestore). Gemini
  Live runs in `us-central1`.
- Merging to `main` deploys automatically (`.github/workflows/ci.yml`). `make deploy` uses
  the gcloud configuration `plantmemory` and asks before creating anything.
- Cloud Run keeps one instance warm by default; `MIN_INSTANCES=0 make deploy` scales to
  zero.
- Scripts must not write to the app's Firestore collections. The scale benchmark writes
  only to `scale_incidents_*`.

## Style

- Match the code around you: its naming, comment density and idioms. Python is 3.13,
  ruff with a line length of 100.
- Use straight apostrophes and quotes in backend strings.
- Write docs and UI text in plain words, for a manager on the floor.
