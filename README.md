# PlantMemory

In a pharma plant, when a machine stops, the workers wait. They escalate to the
maintenance manager, and the line stays down until the manager decides what to do and
tells them. Workers usually can't carry phones on the floor, and the knowledge the
manager needs is scattered across breakdown logbooks, SAP history, equipment manuals and
people's memories.

PlantMemory is built for that manager. Describe the breakdown by typing, by speaking in
any Indian language, from a logbook photo or straight from the machine's alarm log, and
it drafts a **repair guide**:

- steps from the equipment manual's procedure, plus what fixed it before in this plant,
  each step citing its source;
- a warning when this problem keeps coming back or when last time's fix didn't hold;
- the spare parts to collect, with stock and bin location from the store, and a flag
  when a part is short;
- a time estimate from the manual and past downtime.

QA approves the guide (not the person who drafted it). The manager then prints it for
the workers as an A4 controlled copy in English, Telugu and Hindi, with the manual's
figures and tick boxes. When the machine is running again, the manager says what was
actually done and it is saved to plant memory for next time.

Built for the Google Cloud AI Builder Cup (APAC) with Gemini, the Agent Development Kit,
Firestore vector search and Cloud Run.

> **All data in this repository is synthetic.** Incidents, manuals, parts, figures and logs
> are invented for this demo. No real company data is used.

## What's in it

| Screen | What the manager does |
|---|---|
| Breakdown | Type or speak the report (the app asks for what's missing), or read a logbook photo. Get a cited repair guide. |
| Alarm logs | Upload an HMI alarm export or controller log. Errors that stopped the machine come first with the manual's first actions and time; rising warnings are flagged. One click drafts the guide. |
| Guides | Every guide from draft to QA approval, printing and closure, with an audit trail. QA reviews here. |
| Memory | Past incidents, equipment manuals by page, spare parts and stock. |
| Add records | Logbook photos, SAP PM / CMMS exports (CSV or Excel), equipment manual PDFs. |

## Rules enforced in code, not left to the model

- A guide may only cite the past incidents and manual sections it was given; anything
  else is removed and flagged. A line with no source is labelled "general practice".
- A value with a unit (25 Nm, 121 °C, 8 to 10 mm) must appear in a source the line cites,
  or the line is flagged for the manager and QA.
- Parts must exist in the store; stock, bin and lead time come from the store.
- Times come from the manual and past downtime, never from the model.
- Each translation is checked: every number, part number, alarm code and machine tag in
  the English must appear in the Telugu and Hindi, or QA sees a flag.
- QA can't approve a guide they sent; a rejection needs a reason; only approved guides
  print, and every printed copy is numbered and logged.
- Matches from plant memory are checked by Gemini before they count (0 false alarms on
  16 look-alike reports in the eval).

## Quick start

Requires [uv](https://docs.astral.sh/uv/) and pnpm.

```bash
cp .env.example .env   # add a Gemini API key or Vertex AI settings
make install
make seed seed-kb      # synthetic incidents, then manuals, alarm codes, parts, figures
make run               # http://localhost:8473, API docs at /docs
make test
```

Sample files to try are in `data/samples/`: an HMI alarm log and a controller log, an SAP
IW29 export, a fluid bed dryer manual PDF and two logbook photos. Each screen has
"try a sample" buttons.

Printed-guide languages are a setting: `GUIDE_LANGUAGES='["te","hi"]'` (any ISO 639-1
codes; English is always printed).

More: [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md),
[docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md), [docs/DEPLOY.md](docs/DEPLOY.md).
