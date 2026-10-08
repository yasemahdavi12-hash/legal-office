/**
 * Official mehrieh annual index rows (CBI 10899/02, jalali years 1315–1401).
 * Source file: scripts/fixtures/mehr-index-audit.json — not test fixture.
 */
const fs = require('fs');
const path = require('path');

exports.seed = async function seed(knex) {
  const fixturePath = path.join(__dirname, '../../scripts/fixtures/mehr-index-audit.json');
  if (!fs.existsSync(fixturePath)) {
    console.warn('[seed] mehr-index-audit.json missing — skip legal_annual_indices');
    return;
  }

  const rows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(rows) || !rows.length) return;

  const datasetVersion = String(rows[0].datasetVersion || 'cbi-mehrih-annual-index-10899-02-1402-01-22');

  await knex('legal_annual_indices').where('dataset_version', datasetVersion).del();

  const officialUrl = 'https://nezamat.ir/post-44530/';
  const sourceTitle =
    'اعداد شاخص سالانه جهت محاسبه میزان مهریه به وجه رایج (نامه بانک مرکزی 10899/02)';

  const batch = rows.map((r) => ({
    calendar_system: 'jalali',
    year: Number(r.year),
    average_index: Number(r.averageIndex),
    source_name: String(r.sourceOrganization || 'بانک مرکزی جمهوری اسلامی ایران').slice(0, 512),
    source_title: sourceTitle.slice(0, 512),
    source_url: officialUrl.slice(0, 1024),
    source_number: String(r.sourceDocumentNumber || r.sourceNumber || '10899/02').slice(0, 64),
    published_at: String(r.publicationDate || '1402/01/22').slice(0, 64),
    dataset_version: String(r.datasetVersion || datasetVersion).slice(0, 128),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  }));

  const chunk = 50;
  for (let i = 0; i < batch.length; i += chunk) {
    await knex('legal_annual_indices').insert(batch.slice(i, i + chunk));
  }
};
