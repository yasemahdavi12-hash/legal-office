/**
 * Annual legal index row (mehrieh CPI) — ingest / DB target shape.
 *
 * @typedef {Object} AnnualLegalIndexRecord
 * @property {'jalali'} calendarSystem
 * @property {number} year
 * @property {number} averageIndex
 * @property {string} sourceDocument
 * @property {string} sourceNumber
 * @property {string} sourceDate  ISO or official jalali date string from source
 * @property {string} sourceUrl
 * @property {string} datasetVersion
 * @property {string} [ingestedAt] ISO8601 when persisted to DB
 */

const { CALENDAR_SYSTEM, DATASET_VERSION, SOURCE_NUMBER } = require('./constants');

/**
 * Normalize a row from audit fixture JSON into schema shape.
 * @param {object} raw
 * @param {string} [ingestedAt]
 * @returns {AnnualLegalIndexRecord}
 */
function normalizeFixtureRow(raw, ingestedAt = null) {
  const sourceNumber = raw.sourceNumber ?? raw.sourceDocumentNumber ?? '';
  return {
    calendarSystem: CALENDAR_SYSTEM,
    year: Number(raw.year),
    averageIndex: Number(raw.averageIndex),
    sourceDocument: String(raw.sourceDocument ?? ''),
    sourceNumber: String(sourceNumber),
    sourceDate: String(raw.sourceDate ?? raw.publicationDate ?? ''),
    sourceUrl: String(raw.sourceUrl ?? ''),
    datasetVersion: String(raw.datasetVersion ?? DATASET_VERSION),
    ...(ingestedAt ? { ingestedAt } : {})
  };
}

module.exports = { normalizeFixtureRow, CALENDAR_SYSTEM, DATASET_VERSION, SOURCE_NUMBER };
