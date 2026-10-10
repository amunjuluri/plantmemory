# Plant glossary

Abbreviations the logbook ingest step expands when it reads handwritten pages, for
example `PR2` = second press. Each file is a JSON object of `"ABBREVIATION": "meaning"`:

- `generic.json` is always used.
- `<industry>.json` (`paper.json`, `pharma.json`) is added when the upload names that
  industry. With no industry given, all files are used.

All entries are publicly known terms. No company-specific data.
