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
- If a recorded or suspected cause is shallow, such as "operator error", "human error"
  or "operator retrained", say so and suggest asking why the error was possible
  (procedure, equipment design, alarms, workload) before closing the investigation.
- `open_questions`: what the team still needs to find out.
- `summary`: 2 to 4 sentences.
{extra_rules}
"""

EVIDENCE_MATCHES = """\
SIMILAR PAST INCIDENTS (from plant records, best match first):
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
