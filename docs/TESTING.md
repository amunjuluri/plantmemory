# Testing PlantMemory, step by step

This guide walks through every feature in the order a plant uses them: a machine stops,
the manager gets a repair guide, checks and changes it, approves and prints it for the
workers, records what was done, and QA releases the machine. Each section says what to
do, what you should see, and **why it matters on the floor**.

It takes about 30 minutes. Most AI steps take a few seconds; a full repair guide about 10.

## Before you start

**Option A: the live app.** Open https://plantmemory-4l5hbd2imq-el.a.run.app in Chrome.
Nothing to install.

**Option B: run it yourself.** You need [uv](https://docs.astral.sh/uv/), pnpm and a
Gemini API key ([get one](https://aistudio.google.com/apikey)).

```bash
git clone <this repository> && cd plantmemory
cp .env.example .env          # paste your key into GOOGLE_API_KEY
make install
make seed seed-kb             # real past repairs, then the stand-in manuals, parts and figures
make run                      # open http://localhost:8473
```

**The tour.** On your first visit a tour starts on the Breakdown page. The screen dims,
the real control stays lit, and a small popup beside it says what it does, with **Next**
and **Skip**. The welcome card opens with what downtime costs, each figure linked to its source
(Siemens' *True Cost of Downtime 2024*, ABB's 2023 survey of 3,215 plants, and the US
FDA's 2019 drug shortages report). The tour then follows the whole job, and you do the
steps yourself:

- **Speak or type.** Tap **Speak** to take the voice branch. It tells you to turn your
  volume up, then gives you a line to say in English (say it in any language). As the
  assistant asks for what's missing, the suggested answer changes. When the report is
  complete it tells you to say "Yes, that's right", then joins the typing path. **Type
  instead** skips it; if the microphone fails, it says what to check.
- **Draft.** Tap an example, then Draft. The tour waits while it drafts, then explains
  the guide: the repeat warning, time and parts, a step and its source, the parts list.
- **Change it.** Ask for the suggested change; the tour shows how changes are marked,
  then **Keep** or **Discard**.
- **Approve and print.** Tap Approve; the tour follows to the print page (languages,
  the A4 sheet, numbered copies, Save as PDF), then back to the guide to show **Close
  breakdown** and what to say after the repair.
- **The other tabs.** It offers each one (Guides, Alarm logs, Memory, Add records):
  **Open** takes you there and explains the page, **Not now** skips it.

**Guided tour** at the top (**Tour** on a phone) starts it again and offers a choice:
the **full tour**, **this page** (including a guide or the print page), or any one page
(Breakdown, Guides, Alarm logs, Memory, Add records). On Alarm logs, the page tour has
you try a sample log and then points at what stopped the machine. The tour uses Gemini like
normal use does (a draft, a change, a translation), so give it a few minutes.

**Who you are.** The round badge at the top right shows who is acting. Click it to
switch between **Manager** and **QA** and to change the name. Some rules depend on the
name: QA can't approve a guide they sent, and the person who closed a repair can't
release the machine. So use two different names, e.g. "Ravi Kumar" (manager) and
"Sita Rao" (QA).

> **About the data.** The past repairs that come with the app are real public records
> (FDA reports on steam sterilizers). The plant's own manuals, parts, stock and SAP rows
> are invented stand-ins, because no plant publishes them. See
> [data/SOURCES.md](../data/SOURCES.md).

## 1. Give the plant some history (SAP import)

1. Open **Add records** → **SAP / CMMS export**.
2. Click the sample **SAP PM notification list (IW29)**.
3. Gemini maps the export's columns to incident fields. Check the rows, then click
   **Save 12 records**.
4. Open **Memory** → **Incidents**. The new records are listed with their source.

**You should see:** every row of the export kept. Gemini only decides which column is
which; code copies the values, so no row is invented or dropped.

**Why it matters:** plants already keep years of breakdowns in SAP, but nobody reads
them when a machine stops. One export turns that history into answers. The next steps
use these records.

## 2. Report a breakdown by typing

1. Open **Breakdown**. Under **Try an example**, click **TP-02 punch tight**.
2. Click **Draft repair guide**. Watch the steps: understanding the report, searching
   plant memory and the manuals, finding parts, writing the guide.

**You should see** a repair guide with:
- **Safety first**, then numbered **Repair steps**, **Parts to collect** and
  **Before restarting** checks.
- A chip such as **Manual p.16** on every line that comes from the manual. Click it: the
  manual page opens. Lines with no source say so and are marked for QA.
- Parts with stock and bin location from the store, and a warning when stock is short.
- A time estimate from the manual and from past downtime, never made up by the model.

**Why it matters:** today the line waits while the manager searches logbooks, SAP and the
manual. Here the answer arrives in about 10 seconds, and every line shows where it came
from, so the manager can trust it or check it in one click.

## 3. See a repeat breakdown, reported in Telugu

1. Go back to **Breakdown** and click **Autoclave door seal (Telugu)**. The report is in
   Telugu.
2. Click **Draft repair guide**.

**You should see** a yellow **This has happened before** panel: how many times this
happened in the last 12 months, the earlier SAP record from step 1, and the downtime it
cost. If an earlier fix was
recorded as "came back", the panel says **This keeps coming back** and names the fix
that didn't hold.

**Why it matters:** the same fault returning is the most expensive kind of downtime, and
it is usually missed because each breakdown is handled alone. The Telugu report finds
English SAP records because search works by meaning, not by matching words.

## 4. Report a breakdown by voice

1. On **Breakdown**, click **Speak** and allow the microphone. (A microphone only works
   on `https://` or `localhost`.)
2. Talk as a manager would, in any language, e.g. *"TP-02 aagipoyindi, screen meeda
   E-104 vastondi"*. Talk over it if you like.
3. It asks only for what is still missing (which machine, what the screen shows), then
   reads the report back. Say "yes" to draft the guide.

**You should see** a spoken reply about 2 seconds after you stop talking, in your
language, and the report filling in on screen as you talk.

**Why it matters:** managers are often on the floor or on the phone when a machine
stops. Talking in their own language is faster than typing in English, and the app makes
sure the report is complete before it drafts anything.

## 5. Read a handwritten logbook page

1. Open **Add records** → **Logbook photo**, and click the sample
   **Pharma area log (messy)**.
2. Check the entries it read.

**You should see** the entries as editable records. The ink smudge comes back as `[?]`
and is flagged, never guessed. Click **Save** to add them to memory.

**Why it matters:** many plants still write breakdowns in paper logbooks. A photo makes
that history searchable without anyone retyping it, and nothing unreadable is invented.

## 6. Go from a machine's alarm log to a guide

1. Open **Alarm logs** and click the sample **TP-02 HMI alarm export (CSV)**.
2. Look at the results, then click **Draft repair guide** on the top error.

**You should see** errors that stopped the machine listed first, each with the manual's
first actions and an expected time, and warnings that were rising before the stop linked
to the error they led to.

**Why it matters:** the machine's own log often says what went wrong before anyone
describes it. Reading it first saves the guesswork, and rising warnings show a failure
coming before it stops the line.

## 7. Change the draft by talking or typing (new)

Do this as the **Manager**, on a guide that is still a draft (for example the one from
step 2). The box sits in the bar at the bottom of the guide, above
**Approve and print**.

1. **Type a change.** Enter: *Step 3: only the maintenance engineer does this, not the
   operator.* Press Enter.
   - A **Proposed change** card appears at the top: what you asked, and what changed.
   - Changed lines in the guide are marked **New**, **Changed** or **Removed**, with
     the old text shown.
   - The bar now offers **Discard** and **Keep changes**. Nothing is saved yet.
2. **Ask for a second change** before keeping the first, e.g. *Also call me if the punch
   is cracked.* Both changes now show together.
3. **Say something unclear**, e.g. *Make it better.* The app asks one short question
   back instead of guessing. Answer it in the box (e.g. *Shorter steps 4 to 6*): your
   answer is read together with what you asked first.
4. **Use your voice.** Click the microphone in the box, speak for up to a minute in any
   language (Telugu, Hindi, English or mixed), then click the stop button to send. Press
   Esc to cancel. A Telugu request is shown in Telugu, with a **Telugu** badge; the
   guide itself stays in English.
5. **Try something unsafe**, e.g. *Remove the lockout step.* If it is removed, a warning
   says a safety point was removed and asks you to check the workers are still
   protected.
6. **Try a number no source gives**, e.g. *Set the torque to 99 Nm in step 5.* The line
   is flagged, and the guide now needs QA before it can be printed.
7. Click **Keep changes**. Open **Audit trail** at the bottom of the guide: the edit is
   recorded with your request, e.g. *By voice: "…"*.

**Why it matters:** checking the draft is when a manager notices "step 6 is for the
engineer, not the operator". Saying it takes seconds; finding the field and retyping it
in English takes minutes. The change goes through the same checks as the AI's first
draft, so a quick fix can't slip an unchecked value, part or missing lockout onto the
printed sheet.

## 8. Approve and print in the workers' languages

1. On a clean draft, click **Approve and print**. The guide is translated into Telugu
   and Hindi (about 5 seconds), then the print view opens.
2. **Add the language your crew reads.** Click **+ Language** and pick one, e.g.
   **Tamil**. Each language is listed with its name in its own script. It is translated
   and checked in about 5 seconds, then appears on the sheet. Try **Urdu** too: it is
   set right to left.
3. Click a language chip to take it off this copy, or click it again to put it back.
4. Click **Print copy 1**. Open the guide's **Audit trail**: it says who added each
   language, and which languages the copy was printed in (e.g. *Copy 1 in English,
   Telugu, Hindi, Tamil*).

**You should see** an A4 sheet with every line in English and each chosen language under
it, the headings in every language, the manual's figures beside the steps, a tick box
per step, the parts table, and a **Controlled copy** number. Each print is counted
(copy 1, copy 2…).

Supported languages: Assamese, Bengali, Gujarati, Hindi, Kannada, Malayalam, Marathi,
Odia, Punjabi, Tamil, Telugu and Urdu. The ones translated on approval are a setting
(`GUIDE_LANGUAGES`, default Telugu and Hindi).

**On a phone**, the print button opens the phone's print sheet; pick a printer or
**Save as PDF**. If the phone doesn't open it straight away (iPhones need the tap
itself), a message says the copy is recorded, with a **Print** button that opens the
same copy, so no copy number is used up.

**Why it matters:** workers usually can't carry phones on the floor, and a crew often
mixes people from different states. A printed sheet in the languages they read means the
manager explains the job once, and every worker can follow it step by step without
coming back to ask. It also means fewer mistakes on safety steps. Code checks every
translation: if a number, part number or alarm code is missing, the line is flagged. A
language added after approval wasn't seen by QA, so if it has a flagged line it stays
off the sheet with the reason and a **Translate again** button.

## 9. QA review, when code finds a reason

The manager can approve alone only when every line has a source, no value is flagged and
every translation kept its numbers. Otherwise the guide must go to QA.

1. As the **Manager**, make a guide that needs QA (step 7.6 does this), then click
   **Send to QA**.
2. Switch to **QA** with a different name. Open **Guides** → **Waiting for QA**.
3. Check the reasons shown at the top, then either **Approve for printing**, or
   **Send back** (a reason is required; the manager sees it at the top of the guide).
4. Try approving as QA with the same name that sent it: it is refused.

To make QA approve every guide, set `QA_APPROVAL=always` in `.env`.

**Why it matters:** in a GMP plant a wrong instruction is a quality event. QA's time goes
only to the guides that need a second look, and the rules (no self-approval, a reason
for every rejection, an audit trail) are enforced in code, not left to habit.

## 10. Close the breakdown

1. On an approved guide, click **Close breakdown**.
2. Fill in what was done, or click **Speak it instead** and say it (e.g. *"did what the
   guide said, took about an hour and a half"*). While you talk, the voice panel takes
   the form's place and its chips show what is filled in; the form comes back filled.
3. Under **Parts used**, the guide's parts are a tick list: untick any that weren't
   replaced, and type any others.
4. Choose **Is it fixed?** and click **Save and close**.
5. Open **Memory** → **Incidents**: the repair is there.

**You should see** short answers expanded from the guide ("did what the guide said"
becomes the actual steps, and the guide's parts are ticked as used and read back so you
can correct them), and spoken times turned into minutes.

**Why it matters:** every closed repair teaches plant memory. The next time this
breakdown happens, the guide includes what worked here, and a fix marked "came back"
raises the repeat warning.

## 11. QA releases the machine

1. Switch to **QA**, using a name other than the one who closed it.
2. On the closed guide, click **Release to production**, tick every line-clearance check
   and click **Release**.

**You should see** the release refused until every check is ticked, and the person who
closed the repair unable to release it.

**Why it matters:** in pharma a repaired machine can't restart until QA has checked the
area. This records who cleared it and when.

## 12. Add an equipment manual

1. Open **Add records** → **Equipment manual** and click the sample
   **Fluid bed dryer FBD-1 manual (6 pages)**.
2. When it is read, click **Try a breakdown on FBD-1**.

**You should see** the manual's pages, alarm table and figures extracted, then a guide
for FBD-1 that cites this manual.

**Why it matters:** each new machine comes with a manual. Uploading the PDF is enough
for guides to use it.

## 13. A machine with no manual

On **Breakdown**, click **Something new** (a coating pan), then **Draft repair guide**.

**You should see** a guide that doesn't borrow another machine's manual. Its lines are
marked as general practice, so it goes to QA.

**Why it matters:** a confident guide for the wrong machine is worse than none. The app
uses a manual only when Gemini confirms it is for that equipment.

## 14. Phone and dark mode

Open any guide on a phone, or in Chrome's device toolbar at 320 to 414 px wide. Switch
the theme with the sun/moon button.

**You should see** nothing cut off or scrolling sideways. In the bar at the bottom of a
guide, the main action (e.g. **Approve and print**) gets a full-width row at the bottom,
and the other actions share the row above. The print page shows the sheet exactly as it
prints, an A4 page scaled to fit the screen, like a PDF; pinch to zoom in.

## 15. Automated checks

```bash
make test        # backend tests (no Gemini calls; the model is faked)
make check       # lint, tests, UI typecheck and lint: everything CI runs
make eval        # retrieval: search by meaning vs keyword search
make benchmark   # speed, cost, trust and load (calls Gemini: about $2)
```

## Checklist

| # | Feature | Pass when |
|---|---|---|
| 1 | SAP import | Every row saved; visible in Memory |
| 2 | Typed report | Guide in about 10 s; lines cite sources; parts show stock |
| 3 | Repeat warning | Telugu report finds the English SAP record; repeat count and downtime shown |
| 4 | Voice report | Reply in your language; asks only for what's missing |
| 5 | Logbook photo | Smudge flagged as `[?]`, not guessed |
| 6 | Alarm log | Stopping errors first; one click to a guide |
| 7 | Change by voice or chat | Changes marked; nothing saved until kept; unclear request gets a question; audit trail records it |
| 8 | Print | Any of 12 languages added on demand; all on one sheet; copies numbered with their languages; on a phone the print sheet opens (or one more tap opens the same copy) |
| 9 | QA review | No self-approval; rejection needs a reason |
| 10 | Close | Saved to memory; short answers expanded from the guide; "did what the guide said" ticks the guide's parts |
| 11 | Release | All checks needed; closer can't release |
| 12 | Manual upload | New machine's guide cites the uploaded manual |
| 13 | No manual | No other machine's manual used |
| 14 | Phone | No overflow at 320 px; print preview is the A4 page scaled to fit; closing by voice doesn't grow past the screen |
| 15 | Tour | Starts on the first visit; opens without a grey flash; popups point at the real controls; voice branch gives lines to say; waits while the guide drafts; follows approve to the print page; asks before each tab; **Guided tour** offers full, this page or any page |

The app allows 300 AI actions per hour from one network address (`AI_REQUESTS_PER_HOUR`),
far more than a full test needs; past that it answers "too many requests" until the hour
rolls on.
