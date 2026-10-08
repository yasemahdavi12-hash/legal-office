const db = require('../../db/connection');
const { AppError } = require('../../utils/response');
const { MehrIndexStore } = require('../legalTools/mehrIndex/indexStore');
const { CALENDAR_SYSTEM } = require('../legalTools/mehrIndex/schema');
const {
  INDEX_NOT_AVAILABLE_MESSAGE,
  DATASET_VERSION,
  MIN_YEAR,
  MAX_YEAR
} = require('../legalTools/mehrIndex/constants');

/** @type {MehrIndexStore | null | undefined} */
let cachedStore = undefined;
/** @type {string | null} */
let cachedDatasetVersion = null;

function rowsToStore(rows) {
  if (!rows || !rows.length) return null;
  const yearToIndex = new Map();
  let datasetVersion = null;
  for (const r of rows) {
    const y = Number(r.year);
    const v = Number(r.average_index);
    yearToIndex.set(y, v);
    if (!datasetVersion) datasetVersion = String(r.dataset_version || '');
  }
  cachedDatasetVersion = datasetVersion;
  return new MehrIndexStore(yearToIndex, rows);
}

/**
 * Load production index store from DB (no fallback, no interpolation).
 * @returns {Promise<MehrIndexStore | null>}
 */
async function loadProductionStore() {
  const hasTable = await db.schema.hasTable('legal_annual_indices');
  if (!hasTable) return null;

  let rows = await db('legal_annual_indices')
    .where('calendar_system', CALENDAR_SYSTEM)
    .where('dataset_version', DATASET_VERSION)
    .select('year', 'average_index', 'dataset_version', 'calendar_system')
    .orderBy('year', 'asc');

  if (!rows.length && process.env.MEHR_CALC_ALLOW_TEST_DATASET === '1') {
    rows = await db('legal_annual_indices')
      .where('calendar_system', CALENDAR_SYSTEM)
      .where('dataset_version', 'test-mehr-index-fixture-v1')
      .select('year', 'average_index', 'dataset_version', 'calendar_system')
      .orderBy('year', 'asc');
  }

  return rowsToStore(rows);
}

/**
 * Official CBI dataset loaded (1315–1401). Test datasets only when MEHR_CALC_ALLOW_TEST_DATASET=1.
 */
async function isMehrCalcDatasetReady() {
  const store = await getStore();
  if (!store || !store.yearToIndex.size) return false;
  const version = cachedDatasetVersion;
  if (process.env.MEHR_CALC_ALLOW_TEST_DATASET === '1') {
    return version === DATASET_VERSION || version === 'test-mehr-index-fixture-v1';
  }
  if (version !== DATASET_VERSION) return false;
  return store.yearToIndex.has(MIN_YEAR) && store.yearToIndex.has(MAX_YEAR);
}

/**
 * @returns {Promise<MehrIndexStore | null>}
 */
async function getStore() {
  if (cachedStore !== undefined) return cachedStore;
  cachedStore = await loadProductionStore();
  return cachedStore;
}

/** Test hook — inject in-memory store without DB. */
function setStoreForTests(store) {
  cachedStore = store;
  cachedDatasetVersion = store ? 'test-injected' : null;
}

function resetStoreCache() {
  cachedStore = undefined;
  cachedDatasetVersion = null;
}

async function getDatasetVersion() {
  if (cachedStore === undefined) await getStore();
  return cachedDatasetVersion;
}

/**
 * @param {number} year
 * @returns {Promise<number>}
 */
async function getAnnualIndex(year) {
  const store = await getStore();
  if (!store) {
    throw new AppError(INDEX_NOT_AVAILABLE_MESSAGE, 422, {
      code: 'INDEX_NOT_AVAILABLE',
      missingYears: [Number(year)]
    });
  }
  return store.getAverageIndex(year);
}

/**
 * @param {number} year
 * @returns {Promise<boolean>}
 */
async function hasAnnualIndex(year) {
  const store = await getStore();
  if (!store) return false;
  return store.yearToIndex.has(Number(year));
}

module.exports = {
  loadProductionStore,
  getStore,
  getAnnualIndex,
  hasAnnualIndex,
  getDatasetVersion,
  isMehrCalcDatasetReady,
  setStoreForTests,
  resetStoreCache,
  rowsToStore
};
