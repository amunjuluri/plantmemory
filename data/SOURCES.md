# Where the demo data comes from

PlantMemory's job is to cut downtime: when a machine stops, the manager gets a checked
repair guide fast. So the data it needs is repair knowledge: what failed, what fixed it,
and how long it took.

## Real: past repairs (`data/seed/incidents_seed.json`)

17 real repairs of steam sterilizers (the plant's autoclave AC-2 is one). Each comes from
an FDA medical device report (MAUDE) in which the manufacturer's service technician
records what they found and what they replaced, e.g. "found that the door seal required
replacement ... replaced the door seal, tested ... returned the unit to service".

- Source: [openFDA device adverse event API](https://open.fda.gov/apis/device/event/),
  product code FLE (steam sterilizer). Each record links to its FDA report in `source_ref`.
- License: openFDA data is public domain under
  [CC0 1.0](https://open.fda.gov/license/). Credit is given anyway; FDA does not endorse
  this project.
- The text is our plain-English summary of each report, limited to the repair. The
  date, equipment, findings and parts are as reported.
- These repairs happened at other sites (mostly US hospitals). They are stored with
  source `public_record`: guides say "at another site" when they use one, and they never
  count as repeats on this plant's machines. Repeat warnings come only from the plant's
  own records (logbooks, SAP imports, closed guides).

We left out FDA drug recalls and warning letters on purpose: they record a regulator's
verdict, not what fixed the machine, so they don't help get a line running again.

## Stand-ins, labelled as such

No plant publishes these, so they are invented for the demo until a plant provides its own:

| Data | File | Why it can't be public |
|---|---|---|
| Equipment manuals, alarm codes, figures | `data/kb/manuals/`, `data/kb/figures/` | Real manuals for pharma machines are copyrighted, so we don't publish them. |
| Spare parts, stock, bins, lead times | `data/kb/parts.json` | A plant's store is private. |
| SAP IW29 export | `data/samples/sap_iw29_export.csv` | A plant's own maintenance history. |
| HMI alarm log, controller log | `data/samples/alarm_log_tp02.csv`, `cycle_log_ac2.txt` | A plant's own machine logs. |
| Logbook photos | `data/samples/logbook_*.png` | A plant's own handwritten logbooks. |
| Fluid bed dryer manual PDF | `data/samples/manual_fbd120.pdf` | As for manuals. |
| Test reports | `data/eval/` | Written to test the app. |
