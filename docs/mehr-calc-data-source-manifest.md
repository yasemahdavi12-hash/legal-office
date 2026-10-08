# mehr-calc — Data Source Manifest (audit only)

**Purpose:** Source discovery for annual mehrieh (cash) index ingest.  
**Scope:** No code/DB/migration changes. No production index values from third-party sites.  
**Audit date:** 2026-10-08  

---

## 1. Legal basis (non-numeric)

| Source | Issuer | Reference | URL (access notes) | Role |
|--------|--------|-----------|-------------------|------|
| تبصره **ماده ۱۰۸۲** قانون مدنی (الحاق ۱۳۷۷) | مجلس | وجه رایج؛ تعدیل متناسب با **شاخص قیمت سالانه** بانک مرکزی | [qavanin.ir](https://qavanin.ir) — automated fetch: redirect/WAF in audit | Enables cash mehrieh index adjustment |
| **آیین‌نامه اجرایی** قانون الحاق تبصره به ماده ۱۰۸۲ | هیئت وزیران، مصوب **۱۳۷۷/۰۲/۱۳** | **ماده ۲:** نحوه محاسبه (شاخص سال قبل از مطالبه / سال عقد)؛ **ماده ۴:** تکلیف CBI انتشار سالانه تا خرداد | بازنشر قوه قضاییه: [nezamat.ir — آیین‌نامه اجرایی تبصره ۱۰۸۲](https://nezamat.ir/%d8%a2%db%8c%db%8c%d9%86-%d9%86%d8%a7%d9%85%d9%87-%d8%a7%d8%ac%d8%b1%d8%a7%db%8c%db%8c-%d8%a8%d9%86%d8%af-%d8%b4-%d8%aa%d8%a8%d8%b5%d8%b1%d9%87-1-%d9%85%d8%a7%d8%af%d9%87-%d9%88%d8%a7%d8%ad%d8%af/) | Formula policy + CBI duty |
| همان آیین‌نامه | — | **ماده ۳:** در پرداخت از ترکه، **تاریخ فوت** مبنای محاسبه | همان | Death basis (interpretation for product) |
| راهنمای قوه قضاییه (مرکز وکلا) | قوه قضاییه | خلاصه ماده ۲ (فرمول) — **secondary** for cross-check only | [hub.23055.ir/terms/320](https://hub.23055.ir/terms/320) | `secondary_source` — not ingest |

---

## 2. Source manifest — CBI / judiciary index tables

### 2.1 Primary — بخشنامه ۱۳۹۹/۰۱/۱۰ (شماره ۹۹/۲۵۶۰)

| Field | Value |
|-------|--------|
| **name** | اعداد شاخص سالانه جهت محاسبه میزان مهریه به وجه رایج (+ پیوست شاخص ماهانه تأخیر تأدیه) |
| **sourceType** | **official** |
| **issuer** | بانک مرکزی جمهوری اسلامی ایران → قوه قضاییه |
| **letterNumber** | **99/2560** (ثبت ۹۹/۲۵۶۰) |
| **letterDate** | **1399/01/10** |
| **publicationDate (republish)** | 1399/01/19 (nezamat metadata) |
| **official_url** | [https://nezamat.ir/post-41742/](https://nezamat.ir/post-41742/) |
| **attachment** | 2-page table PDF/image on post (annual mehrieh + monthly delay) |
| **coveredYears (annual mehrieh)** | **1315–1398** (متن نامه: «سال **1398** و سال‌های قبل») |
| **indexBase** | **1395 = 100** |
| **indexName (annual table)** | شاخص کل بهای کالاها و خدمات مصرفی در مناطق شهری ایران — «اعداد شاخص سالانه جهت محاسبه میزان مهریه به وجه رایج» |
| **validityStatus** | **Valid for direct citation for jalali index years ≤ 1398** on base 1395=100, **after numeric extract from official attachment** (not from third-party transcriptions). |
| **ingestNote** | Does **not** include index years **1399+**. |

### 2.2 Primary — نامه 10899/02 (۱۴۰۲/۰۱/۲۲)

| Field | Value |
|-------|--------|
| **name** | اعداد شاخص سالانه جهت محاسبه میزان مهریه به وجه رایج و اعداد شاخص ماهانه جهت محاسبه تأخیر تأدیه |
| **sourceType** | **official** (CBI letter; judiciary republish for Official Gazette) |
| **issuer** | بانک مرکزی — محمدرضا فرزین |
| **letterNumber** | **10899/02** |
| **letterDate** | **1402/01/22** |
| **official_url** | [https://nezamat.ir/post-44530/](https://nezamat.ir/post-44530/) |
| **attachment** | Letter image + 2-page index tables |
| **coveredYears (annual mehrieh)** | **1315–1401** (متن: «سال **1401** و سال‌های قبل») |
| **indexBase** | **1395 = 100** (same series as 99/2560) |
| **indexName** | «شاخص محاسبه مهریه (شاخص بهای کالاها و خدمات مصرفی)» / «عدد شاخص» سالانه |
| **validityStatus** | **Current best official chain for years 1399–1401** and historical rows on same base; **supersedes** 99/2560 for overlapping years once extract verified. **Does not contain index year 1402+.** |
| **cbiDirect** | No stable verified deep link in audit (`cbi.ir` WAF/403). |

### 2.3 Primary — prior cycle (context)

| letterNumber | letterDate | scope (text) | official republish |
|--------------|------------|--------------|-------------------|
| 9476/97 | 1397/01/20 | through **1396** | Not re-fetched; cited in prior audits — extract if needed for historical dispute |

### 2.4 Secondary (cross-check only — **not production**)

| URL | Role |
|-----|------|
| [davoudabadi.ir/page/39807136](https://davoudabadi.ir/page/39807136) | Transcription 99/2560 |
| [davoudabadi.ir/page/26943187](https://davoudabadi.ir/page/26943187) | Transcription 10899/02 |
| [dadrah.ir/...615214](https://www.dadrah.ir/consulting-paper.php?requestID=615214) | Calculator citing 1402 index — **not primary** |
| [setareganevekalat.com/mehriyeh](https://setareganevekalat.com/mehriyeh/) | Repost 10899/02 text |

---

## 3. Jalali index years 1399–1404

| Index year | Official document found? | letterNumber | letterDate | coverage text | attachment | index value in manifest |
|------------|-------------------------|--------------|------------|---------------|------------|-------------------------|
| **1399** | **Yes** (via **10899/02** republication) | 10899/02 | 1402/01/22 | included in «1401 و قبل» | nezamat post-44530 PDF | **Not listed** — extract from PRIMARY PDF only |
| **1400** | **Yes** (via **10899/02**) | 10899/02 | 1402/01/22 | same | same | **Not listed** |
| **1401** | **Yes** (via **10899/02**) | 10899/02 | 1402/01/22 | same | same | **Not listed** |
| **1402** | **No** verifiable PRIMARY in this audit | — | — | 10899/02 explicitly **excludes** 1402 as new index year | — | **OFFICIAL_DATA_NOT_VERIFIED** |
| **1403** | **No** | — | — | No nezamat/CBI successor letter located | — | **OFFICIAL_DATA_NOT_VERIFIED** |
| **1404** | **No** | — | — | No successor letter located | — | **OFFICIAL_DATA_NOT_VERIFIED** |

**Note:** Separate annual letters for 1399/1400/1401 alone (e.g. Ordibehesht each year) may exist; **no additional nezamat post** was identified in this audit beyond **41742** (≤1398) and **44530** (≤1401). Ingest should prefer **10899/02** attachment for **1399–1401**.

---

## 4. Proposed dataset schema (no migration)

Table: `legal_annual_indices`

| Column | Type / notes |
|--------|----------------|
| `id` | PK |
| `calendar_system` | e.g. `jalali` |
| `year` | jalali index year |
| `average_index` | decimal, > 0 |
| `base_year` | e.g. `1395` (meaning 100=1395) |
| `source_type` | `official` \| `secondary` (production: **official only**) |
| `source_url` | nezamat / gazette |
| `source_reference` | e.g. `10899/02` |
| `published_at` | letter date |
| `dataset_version` | immutable, e.g. `cbi-mehrih-annual-10899-02-1402-01-22` |
| `ingested_at` | ISO8601 |

**Unique:** `(calendar_system, year)` — one active official row per year.

**Import rules:** idempotent; versioned; duplicate protection; extract only from PRIMARY attachments; missing year → no row (calculator → `LEGAL_DATA_NOT_AVAILABLE`).

---

## 5. Year status table (production)

| سال | شاخص رسمی پیدا شد؟ | منبع رسمی | قابل استفاده در Production؟ |
|-----|-------------------|-----------|----------------------------|
| 1395 | بله (پایه=100 در جدول) | 99/2560 / 10899/02 | بله **پس از extract PDF رسمی** |
| 1396 | بله | 99/2560 / 10899/02 | بله **پس از extract** |
| 1397 | بله | 99/2560 / 10899/02 | بله **پس از extract** |
| 1398 | بله | **99/2560** (مستقیم تا 1398) + 10899/02 | بله **پس از extract** |
| 1399 | بله | **10899/02** (نه 99/2560) | بله **پس از extract** |
| 1400 | بله | **10899/02** | بله **پس از extract** |
| 1401 | بله | **10899/02** | بله **پس از extract** |
| 1402 | **NOT_VERIFIED** | — | **خیر** |
| 1403 | **NOT_VERIFIED** | — | **خیر** |
| 1404 | **NOT_VERIFIED** | — | **خیر** |

Years **1315–1394:** covered by same official tables (10899/02 / 99/2560); production **only after PRIMARY extract**, not from third-party tables.

---

## 6. Final outcome

**`OFFICIAL_DATA_NOT_VERIFIED`**

**Reason:** Index years **1402, 1403, 1404** have **no** confirmed CBI letter / nezamat republication in this audit. Letter **10899/02** does **not** extend to index year **1402+**.

**Partial official chain (ingest-ready after PDF validation, not yet extracted in repo):**

- **1315–1398:** **99/2560** (1399/01/10) + **10899/02** for reconciliation on base 1395=100  
- **1399–1401:** **10899/02** (1402/01/22) — [nezamat.ir/post-44530](https://nezamat.ir/post-44530/)

**Missing for full calculator coverage through 1404:** official annual index rows for jalali years **1402, 1403, 1404** (expect future CBI→judiciary letters, typically post–year-end / by Ordibehesht pattern).

**Next ingest step (when approved):** OCR/validate attachment on post-44530 (+ spot-check 41742 for ≤1398); build `dataset_version`; **do not** copy numbers from davoudabadi/edad/dadrah.

---

## 7. Relation to existing repo artifacts

- `scripts/fixtures/mehr-index-audit.json` — values attributed to **10899/02** but **sourceUrl** on some rows points to **third-party** sites; treat as **draft audit**, not PRIMARY extract, until re-sourced from nezamat PDF.
- Production seed must follow this manifest, not third-party URLs.
