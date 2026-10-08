const fs = require('fs');
const path = require('path');
const { AppError } = require('../../../utils/response');
const { normalizeFixtureRow } = require('./schema');
const { MIN_YEAR, MAX_YEAR } = require('./constants');

/**
 * In-memory index store — no DB. Built from official audit fixture only.
 */
class MehrIndexStore {
  /**
   * @param {Map<number, number>} yearToIndex
   * @param {import('./schema').AnnualLegalIndexRecord[]} records
   */
  constructor(yearToIndex, records) {
    this.yearToIndex = yearToIndex;
    this.records = records;
  }

  /**
   * @param {number} year
   * @returns {number}
   */
  getAverageIndex(year) {
    const y = Number(year);
    if (!Number.isInteger(y)) {
      throw new AppError('سال شاخص نامعتبر است', 400);
    }
    if (!this.yearToIndex.has(y)) {
      throw new AppError('شاخص رسمی موردنیاز برای سال موردنظر در سامانه موجود نیست.', 422, {
        code: 'LEGAL_DATA_NOT_AVAILABLE',
        dataKind: 'mehr_annual_index',
        missingYears: [y]
      });
    }
    const value = this.yearToIndex.get(y);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppError('داده شاخص نامعتبر است', 500, { code: 'INDEX_DATA_INTEGRITY' });
    }
    return value;
  }

  getCoverage() {
    return { minYear: MIN_YEAR, maxYear: MAX_YEAR, count: this.yearToIndex.size };
  }
}

/**
 * Load audit fixture from disk (test / dev ingest preview only — not production import).
 * @param {string} [fixturePath]
 * @returns {MehrIndexStore}
 */
function loadAuditFixtureStore(fixturePath) {
  const filePath =
    fixturePath || path.join(__dirname, '../../../../scripts/fixtures/mehr-index-audit.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error('fixture must be a JSON array');
  }
  const records = raw.map((row) => normalizeFixtureRow(row));
  const yearToIndex = new Map();
  for (const rec of records) {
    yearToIndex.set(rec.year, rec.averageIndex);
  }
  return new MehrIndexStore(yearToIndex, records);
}

/**
 * TEST ONLY — NOT OFFICIAL DATA (tests/fixtures/mehr-index-fixture.json).
 * @param {string} [fixturePath]
 */
function loadTestFixtureStore(fixturePath) {
  const filePath =
    fixturePath || path.join(__dirname, '../../../../tests/fixtures/mehr-index-fixture.json');
  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = envelope.rows || [];
  const datasetVersion = String(envelope.datasetVersion || 'test-mehr-index-fixture-v1');
  const records = rows.map((row) =>
    normalizeFixtureRow({ ...row, datasetVersion, sourceDocument: envelope._comment || 'TEST' })
  );
  const yearToIndex = new Map();
  for (const rec of records) {
    yearToIndex.set(rec.year, rec.averageIndex);
  }
  return new MehrIndexStore(yearToIndex, records);
}

module.exports = { MehrIndexStore, loadAuditFixtureStore, loadTestFixtureStore };
