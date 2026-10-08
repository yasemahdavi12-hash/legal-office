const {
  DATASET_VERSION,
  CALENDAR_SYSTEM,
  MIN_YEAR,
  MAX_YEAR,
  SOURCE_NUMBER
} = require('./constants');
const { normalizeFixtureRow } = require('./schema');

/**
 * Validate official audit fixture contents.
 * @param {object[]} rawRows
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateMehrAuditFixture(rawRows) {
  const errors = [];
  if (!Array.isArray(rawRows)) {
    return { ok: false, errors: ['root must be array'] };
  }
  if (rawRows.length !== 87) {
    errors.push(`expected 87 records, got ${rawRows.length}`);
  }

  const years = rawRows.map((r) => Number(r.year));
  const duplicates = years.filter((y, i) => years.indexOf(y) !== i);
  if (duplicates.length) {
    errors.push(`duplicate years: ${[...new Set(duplicates)].join(',')}`);
  }

  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) {
    if (!years.includes(y)) errors.push(`missing year ${y}`);
  }
  for (const y of years) {
    if (y < MIN_YEAR || y > MAX_YEAR) errors.push(`year out of range: ${y}`);
  }

  for (const raw of rawRows) {
    const rec = normalizeFixtureRow(raw);
    if (rec.calendarSystem !== CALENDAR_SYSTEM) {
      errors.push(`calendarSystem not jalali for year ${rec.year}`);
    }
    if (!(rec.averageIndex > 0)) {
      errors.push(`averageIndex not positive for year ${rec.year}`);
    }
    if (rec.datasetVersion !== DATASET_VERSION) {
      errors.push(`datasetVersion mismatch for year ${rec.year}`);
    }
    if (rec.sourceNumber !== SOURCE_NUMBER) {
      errors.push(`sourceNumber not ${SOURCE_NUMBER} for year ${rec.year}`);
    }
  }

  const has1402Plus = years.some((y) => y >= 1402);
  if (has1402Plus) errors.push('fixture must not contain years >= 1402');

  return { ok: errors.length === 0, errors };
}

module.exports = { validateMehrAuditFixture };
