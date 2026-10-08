/**
 * Pure mehr calculator tests — TEST fixture only (not official audit data).
 */
const { AppError } = require('../src/utils/response');
const { loadTestFixtureStore, loadAuditFixtureStore, MehrIndexStore } = require('../src/services/legalTools/mehrIndex/indexStore');
const {
  calculateMehrPure,
  roundCalculatedAmount,
  parsePositiveAmount
} = require('../src/services/legalTools/mehrIndex/calculatePure');

const testStore = loadTestFixtureStore();
const auditStore = loadAuditFixtureStore();
const results = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function expectLegalDataMissing(name, fn, status = 422) {
  try {
    fn();
    assert(name, false, 'expected throw');
  } catch (e) {
    const c = e instanceof AppError ? e.details?.code : null;
    const st = e instanceof AppError ? e.status : null;
    assert(name, e instanceof AppError && c === 'LEGAL_DATA_NOT_AVAILABLE' && st === status, e.message);
  }
}

function expectValidation(name, fn) {
  try {
    fn();
    assert(name, false, 'expected throw');
  } catch (e) {
    assert(name, e instanceof AppError && e.status === 400, e.message);
  }
}

// --- TEST FIXTURE calculations ---
const normal = calculateMehrPure(
  {
    amount: 1_000_000,
    currency: 'IRR',
    contractYear: 1390,
    basisType: 'payment',
    paymentYear: 1400
  },
  testStore,
  'test-mehr-index-fixture-v1'
);
assert('normal multi-year amount', normal.calculatedAmount === 2_000_000, String(normal.calculatedAmount));
assert('indexYearNumerator 1399', normal.indexYearNumerator === 1399);

const toman = calculateMehrPure(
  {
    amount: 100_000,
    currency: 'IRT',
    contractYear: 1390,
    basisType: 'payment',
    paymentYear: 1400
  },
  testStore,
  'test-mehr-index-fixture-v1'
);
assert('IRT → IRR', toman.amountInIRR === 1_000_000 && toman.calculatedAmount === 2_000_000);

const sameYear = calculateMehrPure(
  {
    amount: 50_000_000,
    currency: 'IRR',
    contractYear: 1400,
    basisType: 'payment',
    paymentYear: 1400
  },
  testStore,
  'test-mehr-index-fixture-v1'
);
assert(
  'same reference/contract year',
  sameYear.indexYearNumerator === 1399 && sameYear.calculatedAmount === 40_000_000,
  String(sameYear.calculatedAmount)
);

const death = calculateMehrPure(
  {
    amount: 1_000_000,
    currency: 'IRR',
    contractYear: 1390,
    basisType: 'death',
    deathDate: '1400-08-01'
  },
  testStore,
  'test-mehr-index-fixture-v1'
);
assert('death basis', death.referenceYear === 1400 && death.calculatedAmount === 2_000_000);

assert('deterministic rounding', roundCalculatedAmount(1.4) === 1 && roundCalculatedAmount(1.6) === 2);

expectValidation('amount zero', () =>
  calculateMehrPure(
    { amount: 0, currency: 'IRR', contractYear: 1390, basisType: 'payment', paymentYear: 1400 },
    testStore
  )
);
expectValidation('amount negative', () =>
  calculateMehrPure(
    { amount: -1, currency: 'IRR', contractYear: 1390, basisType: 'payment', paymentYear: 1400 },
    testStore
  )
);
expectValidation('invalid currency', () => parsePositiveAmount(100, 'USD'));

expectLegalDataMissing('missing contract index', () =>
  calculateMehrPure(
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1370,
      basisType: 'payment',
      paymentYear: 1400
    },
    testStore
  )
);

expectLegalDataMissing('missing numerator index', () =>
  calculateMehrPure(
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1395,
      basisType: 'payment',
      paymentYear: 1403
    },
    testStore
  )
);

expectValidation('reference before contract chronology', () =>
  calculateMehrPure(
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1400,
      basisType: 'payment',
      paymentYear: 1390
    },
    testStore
  )
);

expectValidation('death with paymentYear rejected', () =>
  calculateMehrPure(
    {
      amount: 1,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'death',
      deathDate: '1400-01-01',
      paymentYear: 1400
    },
    testStore
  )
);

// --- Official audit fixture: 1402 ok, 1403 missing ---
const pay1402 = calculateMehrPure(
  {
    amount: 10_000_000,
    currency: 'IRR',
    contractYear: 1395,
    basisType: 'payment',
    paymentYear: 1402
  },
  auditStore
);
assert('audit paymentYear 1402', pay1402.indexYearNumerator === 1401);

expectLegalDataMissing('audit paymentYear 1403', () =>
  calculateMehrPure(
    {
      amount: 10_000_000,
      currency: 'IRR',
      contractYear: 1395,
      basisType: 'payment',
      paymentYear: 1403
    },
    auditStore
  )
);

const badStore = new MehrIndexStore(new Map([[1390, -1]]), []);
try {
  badStore.getAverageIndex(1390);
  assert('index integrity', false);
} catch (e) {
  assert('index integrity', e.details?.code === 'INDEX_DATA_INTEGRITY');
}

console.log('\n---');
const failed = results.filter((r) => !r.ok);
console.log(`mehr-calc-pure: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
