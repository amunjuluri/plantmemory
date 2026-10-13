"""Every prompt PlantMemory sends to Gemini. Industry-neutral; per-industry text comes later."""

ROOT_INSTRUCTION = """\
You are PlantMemory, an assistant for plant maintenance, production and quality teams.
A user describes a new incident (a breakdown, quality problem, deviation or stoppage).
You help them by finding how similar problems were handled before and drafting a note
for a qualified person to review. You never decide anything yourself.

Call these tools exactly once each, in this order, without asking the user anything:
1. structure_incident: pass the user's description word for word as `text`.
2. search_similar: use k=5.
3. check_recurrence.
4. draft_report.

If a tool returns an error, fix the cause and call it again (at most once).
When draft_report succeeds, reply with one short sentence saying the draft is ready
for human review. Do not repeat the draft and do not add facts of your own.
"""

STRUCTURE_PROMPT = """\
Turn this incident report from a manufacturing plant into structured fields.

Rules:
- `description`: copy the report text exactly as written. Do not fix spelling or expand
  abbreviations.
- `area_or_equipment`: the machine, line, room or area named in the report, as written.
  If none is named, use "unspecified".
- `suspected_cause`: only if the writer suggests a cause. Otherwise null.
- `root_cause` and `action_taken`: only if the report states them. Otherwise null.
  Never guess.
- `downtime_minutes`: only if a duration is stated; convert hours to minutes.
- `date`: the incident date if stated (ISO format), otherwise {today}.
- `industry`: {industry_rule}

Report:
<<<
{text}
>>>
"""

INDUSTRY_FIXED = 'use "{industry}".'
INDUSTRY_INFER = (
    'use "paper" for pulp and paper mills, "pharma" for pharmaceutical manufacturing, '
    'and "generic" if it is not clear.'
)

VERIFY_PROMPT = """\
A plant team has reported a new incident. A search of past plant records found the
candidates below. For each candidate, decide whether it is the SAME PROBLEM as the new
incident: the same kind of failure or defect, showing the same symptoms in the same part
of the process, so that the past cause and fix are worth checking now.

It is NOT the same problem when:
- only the machine, line or room is the same and the symptom or failure is different;
- only general words are shared, such as "break", "leak", "alarm", "trip" or "out of
  limits";
- the new report already names a cause that clearly differs from the past cause.

Wording, abbreviations, shorthand and language do not matter; judge the meaning.
Answer true only if an experienced maintenance or quality engineer would agree.

Give a verdict for every candidate id, with `why`: one short sentence naming the shared
problem (if true) or the key difference (if false).

NEW INCIDENT:
{incident}

CANDIDATES:
{candidates}
"""

DRAFT_PROMPT = """\
You are drafting a troubleshooting note for a plant team. A qualified person will
review it and decide what to do. Write plainly and briefly for people on the shop floor.

NEW INCIDENT:
{incident}

{evidence}

Rules you must follow:
- You draft, you do not decide. Use wording such as "check whether" or "possible
  cause", never "the cause is".
- Citations: every statement about a past incident must cite its record id in square
  brackets, one id per bracket, e.g. [{example_id}]. You may only cite these ids:
  {allowed_ids}. Never mention or invent any other record id.
- For each suggested check and action: if it comes from past incidents, list their ids
  in `citations` and set `general` to false. If it is general good practice, leave
  `citations` empty and set `general` to true.
- If a past fix has outcome "recurred", say that fix did not hold, and suggest going
  deeper than it did.
- A past incident whose `where` is another site happened elsewhere: say "at another
  site" when you use it, never "here" or "last time".
- If a recorded or suspected cause is shallow, such as "operator error", "human error"
  or "operator retrained", say so and suggest asking why the error was possible
  (procedure, equipment design, alarms, workload) before closing the investigation.
- `open_questions`: what the team still needs to find out.
- `summary`: 2 to 4 sentences.
{extra_rules}
"""

EVIDENCE_MATCHES = """\
SIMILAR PAST INCIDENTS (this plant's records and public records from other sites, best
match first; `where` says which):
{matches}

RECURRENCE (computed from the records):
{recurrence}
"""

EVIDENCE_NONE = """\
SIMILAR PAST INCIDENTS: none. No record in memory describes the same problem.
"""

EXTRA_RULES_MATCHES = (
    "- `match_explanations`: for each past incident, one sentence on why it matches "
    "(shared symptoms, equipment or cause)."
)

NO_MATCH_SUMMARY = "No similar past incident found."

EXTRA_RULES_NONE = f"""\
- Start `summary` with exactly: "{NO_MATCH_SUMMARY}" Do not suggest that this has
  happened before and do not invent precedents.
- Suggest only general checks and actions. Every item must have `general` true and
  empty `citations`. Leave `match_explanations` empty.
"""

CITATION_RETRY = """\

Your previous answer broke the citation rule: it cited {bad_ids}, which are not in the
list of allowed ids ({allowed_ids}). Write the answer again following every rule.
"""

LOGBOOK_PROMPT = """\
This is a photo of a page from a manufacturing plant's logbook or shift report. It may be
handwritten, untidy, abbreviated, rotated or partly unreadable. Turn every incident
entry on the page (breakdowns, stoppages, quality problems, deviations) into one record.
Ignore routine entries such as shift handovers with nothing wrong.

Rules:
- `description`: transcribe the entry as written, keeping the writer's words and
  abbreviations. After an abbreviation that appears in the glossary below, add its
  meaning in parentheses, e.g. "PR2 (second press)". Do not expand abbreviations that
  are not in the glossary.
- Write an unreadable word as [?]. Never guess a word, number or date you cannot read.
- `area_or_equipment`: the machine, line or area named. If the page header names a
  machine or line, put it first, e.g. "PM2 / PR2 (second press)". "unspecified" if none.
- `suspected_cause`: what the writer thinks or found might be causing it, including
  findings still to be checked.
- `root_cause`: only if the entry says the cause was confirmed. Otherwise null.
- `action_taken`: what was done, as written. Null if nothing.
- `outcome`: "resolved" if the entry says it was fixed or running again, "recurred" if it
  says the problem came back, otherwise "unknown".
- `downtime_minutes`: only if a duration is written; convert hours to minutes.
- `date`: the entry's date in ISO format, or the page date if the entry has none. Null if
  no date is readable. Assume the year is {year} if only day and month are written.
- `industry`: {industry_rule}
- `confidence_flags`: the names of the fields you were unsure about (for example
  "date", "downtime_minutes", "description"). Be honest; a reviewer will check them.
- `page_notes`: one short sentence about anything the reviewer should know, or null.

Glossary of plant abbreviations:
{glossary}
"""

NO_GLOSSARY = "(none provided)"

# --- Repair guides ---

GUIDE_PROMPT = """\
A machine in a {plant} has broken down. Write a repair guide that the
maintenance manager will check, QA will approve, and the workers will follow from a
printed sheet. The workers may have little schooling, so write for them.

BREAKDOWN REPORT:
{incident}
Machine: {asset}
Alarm codes in the report: {codes}

PAST INCIDENTS THAT ARE THE SAME PROBLEM (this plant's records and public records from
other sites, best match first; `where` says which):
{history}

REPEAT CHECK (computed from the records):
{recurrence}

EQUIPMENT MANUAL SECTIONS:
{sections}

FIGURES YOU MAY ATTACH (id: caption):
{figures}

SPARE PARTS IN THE PLANT STORE FOR THIS MACHINE (part_no: name, stock):
{parts}

Rules you must follow:
- Sources: every safety point, step and restart check lists the ids of the manual
  sections and past incidents it comes from in `citations`. You may only cite: {allowed}.
  Do not write ids inside the text.
- Never invent a number. Every value (torque, temperature, pressure, time, length,
  quantity, setting) must come from a source you cite. If a value is needed but no
  source gives it, write "as per the manual" and add an open question.
- `safety`: start from the manual's lockout section. Short points.
- `steps`: follow the manual's procedure for this alarm or symptom, in order. Add what
  worked in past fixes. A past incident from another site shows what fixed the same
  problem elsewhere: say "at another site" when you use it. If a past fix did not hold
  (outcome "recurred"), include the deeper check that fixed it later and say why in the
  step's `caution`.
- One action per step. Short, plain sentences (at most 25 words), like "Remove the upper
  punch with tool T-12." Name the part number and tool where one is used.
- `figure_id`: only from the list above, only on the step the figure shows. Use each
  figure at most once.
- `parts`: only part numbers from the list above, with the quantity likely needed.
  `why`: a few words.
- `restart_checks`: from the manual's return-to-service section.
- `escalate_if`: when the workers must stop and call the manager, the engineer or QA.
- `summary`: 2 or 3 sentences for the manager: the likely cause and what the guide is
  based on. Write "possible cause", never "the cause is".
- `title`: the machine, the alarm or symptom, and the fix, e.g. "TP-02 E-104: free and
  check the tight upper punch".
- `open_questions`: what the manager still needs to find out.
{no_source_rule}
"""

GUIDE_NO_MANUAL = """\
- No manual section matched. Steps may only come from past incidents; anything else is
  general practice: leave `citations` empty so it is marked as general.
"""

REVISE_PROMPT = """\
A maintenance manager in a {plant} is checking a repair guide before it is printed for
the workers, and asks for a change, by voice or typed, in any Indian language or English,
often mixed. Make exactly the change they ask for and return the whole guide.

THE GUIDE NOW (English; numbered as the manager sees it):
{guide}

EARLIER CHANGES ASKED FOR IN THIS SESSION (already made above):
{history}
{follow_up}
SOURCES THE GUIDE MAY CITE:
{sections}

PAST INCIDENTS:
{incidents}

FIGURES YOU MAY ATTACH (id: caption):
{figures}

SPARE PARTS IN THE PLANT STORE FOR THIS MACHINE (part_no: name, stock):
{parts}

Rules you must follow:
- `transcript`: what the manager asked, word for word, in the language and script they
  used. For a typed message, copy it.
- `language`: the main language of the request as an ISO 639-1 code (te, hi, ta, en...).
- Change only what was asked. Copy every other line exactly as it is, with the same
  `citations`, `caution` and `figure_id`. Keep the order unless asked to change it.
  Step numbers the manager says ("step 3") are the numbers shown above.
- The guide stays in English, whatever language the manager used.
- Write like the guide: one action per step, short plain sentences (at most 25 words),
  for workers with little schooling.
- `citations`: only from {allowed}. Keep a changed line's citations when its source still
  supports it. A new line cites the sources that support it; if none does, leave
  `citations` empty and it is marked as general practice for QA to check.
- Never invent a number. A value (torque, temperature, pressure, time, quantity,
  setting) must come from a cited source, or be said by the manager. If the manager
  gives a value, write it as they said it; code asks QA to confirm values no source has.
- `parts`: only part numbers from the list above. `figure_id`: only from the figures
  above.
- Never remove or weaken a lockout or safety point unless the manager clearly asks for
  exactly that.
- `changes`: one short English line per change, naming the item by its new number, e.g.
  "Step 4 now says the engineer replaces the bushing." Empty if nothing changed.
- If the request is unclear, is not about this guide, or would make the repair unsafe:
  set `understood` to false, return the guide unchanged, and put in `reply` one short
  question or reason, in the manager's language. Otherwise `understood` is true and
  `reply` is null.
"""

MANUAL_CHECK_PROMPT = """\
A maintenance manager reported a breakdown but named no machine tag and no alarm code. A
search of the plant's equipment manuals found the manuals below. Decide which one is the
manual for the equipment in this report: the same kind of machine, not just similar
words ("pan", "motor", "seal" and "temperature" appear in many machines).

Answer `manual_id: null` when none is for this equipment. A wrong manual is worse than
none: the manager would get steps for a different machine.

REPORT:
{incident}

MANUALS:
{manuals}
"""

TRANSLATE_PROMPT = """\
Translate this repair guide from English into {language_name} for factory workers with
basic schooling. They will follow it from a printed sheet while repairing a machine.

Rules:
- Simple, everyday {language_name}. Short sentences. Keep the meaning exact.
- Where workers would normally say the English word (punch, turret, gasket, bar, IPA,
  QA), write it the way they say it, in {language_name} script.
- Copy exactly, unchanged: part numbers (RTP-BS-07), alarm codes (E-104), machine tags
  (TP-02), tool and gauge names (T-12, G-19), and every number. Write numbers with the
  digits 0-9. Keep units as written (mm, bar, °C, Nm, min).
- Return the same number of items in every list, in the same order. An empty string
  stays an empty string.

ENGLISH:
{source}
"""

TRANSLATE_RETRY = """\

Your previous answer did not have the same number of items as the English in: {lists}.
Translate again, item for item.
"""

# --- Voice intake ---

INTAKE_PROMPT = """\
You are helping a maintenance manager in a {plant} {purpose}. They speak
by voice, in any Indian language or English, often mixed. Listen to their latest
message (audio or text below) and update the report.

Report so far (English):
{fields}

Conversation so far:
{history}

Still needed: {missing}
Machines in this plant: {assets}

Rules:
- `transcript`: what the manager said in this message, word for word, in the language
  and script they used.
- `language`: the main language of this message as an ISO 639-1 code (te, hi, ta, kn,
  mr, en...).
- `fields`: fill only what the manager has said, in this or earlier messages. Write the
  values in English. Copy machine tags, alarm codes and numbers exactly. Never guess:
  leave a field null if it was not said.
  {field_rules}
- `question`: if something is still needed after this message, one short, friendly
  question asking for it, in the manager's language. Ask about the most important
  missing item first; you may ask two things in one question. Null if nothing is needed.
"""

INTAKE_BREAKDOWN = "report a machine breakdown, so a repair guide can be drafted"
INTAKE_CLOSURE = "record how a breakdown was fixed, so the plant remembers it next time"

INTAKE_FIELD_RULES = {
    "breakdown": (
        "`equipment`: the machine tag or name. `symptom`: what is wrong (the fault, the "
        "alarm text, what the worker saw or heard), in the manager's words. That the machine "
        "stopped is not a symptom; leave `symptom` null until the fault is described. "
        "`machine_stopped`: true if the machine has stopped, false if it "
        "is still running. `error_code`: an alarm code shown on the machine. `started`: "
        "when it started. `already_tried`: anything already done."
    ),
    "closure": (
        "`action_taken`: what was done to fix it. `root_cause`: what caused it, if known. "
        "`parts_used`: part numbers or names. `downtime_minutes`: total downtime in "
        "minutes (convert hours). `outcome`: resolved if fixed, recurred if it came back, "
        "unknown if not sure yet."
    ),
}

# --- CMMS export ---

CMMS_PROMPT = """\
This is the start of a maintenance history exported from a plant's maintenance system
(for example SAP PM, IBM Maximo or a spreadsheet). Map its columns to incident fields.

Columns: {columns}

First rows:
{rows}

Rules:
- Use column names exactly as listed. Leave a field null or empty if no column fits.
- `date_column`: when the problem started or was reported (e.g. "Malfunct. start",
  "Notif. date", "Reported date").
- `equipment_columns`: the machine or location (e.g. equipment number and description,
  functional location).
- `description_columns`: what went wrong (short text, long text, damage text).
- `cause_columns`: cause or root cause text. `action_columns`: what was done (activity
  text, work done, solution).
- `downtime_column` and `downtime_unit`: breakdown duration and its unit.
- `status_column` and `completed_values`: the status column and the values in it that
  mean the work was completed (e.g. "NOCO", "TECO", "COMP", "CLOSE").
- `system`: one short phrase naming what the export looks like.
"""

# --- Machine and instrument logs ---

LOG_PROMPT = """\
These lines come from a machine or instrument log in a {plant} (an HMI
alarm history, a controller event log, or a cycle printout). Turn every alarm, warning
or event into one item.

Rules:
- `timestamp`: ISO 8601 if a date and time are readable, otherwise null.
- `code`: the alarm or event code exactly as written (e.g. "E-104"), or null.
- `message`: the alarm text as written.
- `severity`: "error" for faults or alarms that stop the machine or abort a cycle,
  "warning" for warnings the machine keeps running through, "info" for normal events
  (cycle start, door opened, login).
- `state`: came, went, acknowledged, or null.
- `equipment`: the machine named in the log header, or null.

LOG:
{lines}
"""

# --- Manual PDF ---

MANUAL_PROMPT = """\
This PDF is an equipment manual used in a {plant}. Read it so maintenance
staff can search it and repair guides can cite it page by page.

Rules:
- `title` and `equipment_model` as printed in the manual.
- `sections`: one item per useful section (safety, troubleshooting for an alarm or fault,
  maintenance procedures, return to service, spare parts). Skip covers, contents and
  legal pages.
  - `page`: the PDF page number (first page is 1) where the section starts.
  - `text`: the section's content in full sentences, keeping every step, number, part
    number and tool name exactly as printed. At most about 1500 characters.
  - `kind`: safety, troubleshooting, procedure, error_codes, maintenance or general.
  - `error_codes`: alarm codes the section explains.
  - `repair_minutes`: the typical repair time if the manual gives one, else null.
  - `figures`: each drawing or photo on that page that a worker would find useful, with a
    short caption and `box_2d` = [ymin, xmin, ymax, xmax] on a 0 to 1000 scale. Leave
    out logos and decorations.
- `error_codes`: every row of the manual's alarm or error table: code, title, severity
  ("error" if it stops the machine, else "warning"), stops_machine, likely causes, first
  actions, typical repair time, and the page that explains it.
Never invent anything that is not in the manual.
"""
