/**
 * Idempotent ingest of official mehrieh annual indices into legal_annual_indices.
 * Requires MEHR_IMPORT_OFFICIAL=1 and validated audit JSON (scripts/fixtures/mehr-index-audit.json).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const { validateMehrAuditFixture } = require('../src/services/legalTools/mehrIndex/fixtureValidate');
const { DATASET_VERSION } = require('../src/services/legalTools/mehrIndex/constants');
const mehrIndexService = require('../src/services/legal/mehrIndex.service');

const FIXTURE = path.join(__dirname, 'fixtures', 'mehr-index-audit.json');
const OFFICIAL_URL = 'https://nezamat.ir/post-44530/';
const SOURCE_TITLE =
  'اعداد شاخص سالانه جهت محاسبه میزان مهریه به وجه رایج (نامه بانک مرکزی 10899/02)';

async function main() {
  if (process.env.MEHR_IMPORT_OFFICIAL !== '1') {
    console.error('[import-mehr-indices] Set MEHR_IMPORT_OFFICIAL=1 to run official ingest.');
    process.exit(1);
  }
  if (!fs.existsSync(FIXTURE)) {
    console.error('[import-mehr-indices] Missing fixture:', FIXTURE);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const { ok, errors } = validateMehrAuditFixture(rows);
  if (!ok) {
    console.error('[import-mehr-indices] Validation failed:', errors.join('; '));
    process.exit(1);
  }

  await db.migrate.latest();
  const hasTable = await db.schema.hasTable('legal_annual_indices');
  if (!hasTable) {
    console.error('[import-mehr-indices] Table legal_annual_indices missing after migrate.');
    process.exit(1);
  }

  const datasetVersion = String(rows[0].datasetVersion || DATASET_VERSION);
  await db('legal_annual_indices').where('dataset_version', datasetVersion).del();

  const batch = rows.map((r) => ({
    calendar_system: 'jalali',
    year: Number(r.year),
    average_index: Number(r.averageIndex),
    source_name: String(r.sourceOrganization || 'بانک مرکزی جمهوری اسلامی ایران').slice(0, 512),
    source_title: SOURCE_TITLE.slice(0, 512),
    source_url: OFFICIAL_URL.slice(0, 1024),
    source_number: String(r.sourceDocumentNumber || '10899/02').slice(0, 64),
    published_at: String(r.publicationDate || '1402/01/22').slice(0, 64),
    dataset_version: datasetVersion,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }));

  const chunk = 50;
  for (let i = 0; i < batch.length; i += chunk) {
    await db('legal_annual_indices').insert(batch.slice(i, i + chunk));
  }

  mehrIndexService.resetStoreCache();
  const count = await db('legal_annual_indices')
    .where('dataset_version', datasetVersion)
    .count('* as c');
  console.log(
    `[import-mehr-indices] OK inserted ${count[0].c} rows, version=${datasetVersion}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
