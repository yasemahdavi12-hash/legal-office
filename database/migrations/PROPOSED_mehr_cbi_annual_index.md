# Proposed migration (NOT applied — awaiting approval)

Table: `legal_mehri_annual_index`

| Column | Type | Notes |
|--------|------|--------|
| id | increments | PK |
| calendar_system | string(16) | always `jalali` |
| year | integer | jalali year |
| average_index | decimal(20,6) | > 0 |
| source_document | text | |
| source_number | string(32) | e.g. `10899/02` |
| source_date | string(32) | official date string |
| source_url | text | |
| dataset_version | string(128) | e.g. `cbi-mehrih-annual-index-10899-02-1402-01-22` |
| ingested_at | datetime | ISO ingest time |
| created_at / updated_at | timestamps | |

Unique: `(dataset_version, year)`

Seed only from approved ingest of `scripts/fixtures/mehr-index-audit.json` (1315–1401). No 1402+ rows until an official source is approved.
