# PlantMemory

When something goes wrong on a plant floor, the people fixing it rarely find how the
same problem was solved before. Past fixes live in logbooks, reports and people's
memories, and search is by keyword.

PlantMemory finds similar past incidents **by meaning**, flags repeats, and drafts a
cited troubleshooting note that a human reviews and approves. Approved notes are saved
back, so the memory grows with use.

Built for the Google Cloud AI Builder Cup (APAC) with Gemini, the Agent Development Kit
and Cloud Run.

> **All data in this repository is synthetic.** No real company data is used.

## Quick start

Requires [uv](https://docs.astral.sh/uv/) (it installs the right Python for you).

```bash
cp .env.example .env   # add a Gemini API key or Vertex AI settings
make install
make run               # http://localhost:8080, API docs at /docs
make test
```

Full documentation is coming in later phases: see `docs/`.
