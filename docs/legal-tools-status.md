# Legal Tools — production status (audit)

Last updated: automated pipeline. Do not treat third-party sites as primary legal sources.

## READY

| slug | legal source | dataset |
|------|--------------|---------|
| `date-diff` | calendar math (Gregorian); not a legal deadline engine | n/a |
| `deadline-add` | calendar math (Gregorian); not holidays/law deadlines | n/a |
| `delay-interest-user-rate` | simple interest; **user-supplied rate only** | n/a |
| `mehr-calc` | CBI letter **10899/02** (1402/01/22), table through jalali index **year 1401**; formula M×I(prev)/I(contract) per product spec | `legal_annual_indices` seed from `scripts/fixtures/mehr-index-audit.json`; **1402+ index years not ingested** |

## BLOCKED_LEGAL_SOURCE

| slug | blocker |
|------|---------|
| `court-fees` | No versioned official **هزینه دادرسی** table ingested in repo; amounts vary by claim type/stage and require primary gazette/judiciary tariff. |
| `attorney-fee` | No official **تعرفه حق‌الوکاله** dataset in repo; case-specific and tariff-driven. |
| `diyeh` | No official **دیه** amounts by year/organ in repo (مصوب yearly tables required). |
| `cheque-tools` | No scoped v1 with verified formulas + official penalty/interest tables without interpretation. |
| `inheritance-share` | Requires full heir graph + fiqh/legal rules (Ta'sib, Radd, blocked heirs); not safely automatable without expert-validated rule engine and sources. |

## Official delay damages (not a separate slug)

Judicial **خسارت تأخیر تأدیه** uses CBI **monthly** index tables (distinct from mehrieh annual table). No verified monthly dataset in repo → no new calculator slug added.

## mehr-calc ingest note

Run `npm run migrate` then `npm run seed` (seed `002_legal_annual_indices_official.js`) on each environment. Do **not** run `migrate:production` from automation.
