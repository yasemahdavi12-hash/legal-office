/**
 * Pure mehr calculator tests — TEST fixture for math; audit fixture for coverage years.
 */
const { AppError } = require('../src/utils/response');
const { loadTestFixtureStore, loadAuditFixtureStore, MehrIndexStore } = require('../src/services/legalTools/mehrIndex/indexStore');
const {
  calculateMehrPure,
  roundCalculatedAmount,
  parsePositiveAmount
} = require('../src/services/legalTools/mehrIndex/calculatePure');
const { MIN_YEAR, MAX_YEAR } = require('../src/services/legalTools/mehrIndex/constants');

const testStore = loadTestFixtureStore();
const auditStore = loadAuditFixtureStore();
const results = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function expectIndexMissing(name, fn, status = 422) {
  try {
    fn();
    assert(name, false, 'expected throw');
  } catch (e) {
    const c = e instanceof AppError ? e.details?.code : null;
    const st = e instanceof AppError ? e.status : null;
    assert(name, e instanceof AppError && c === 'INDEX_NOT_AVAILABLE' && st === status, e.message);
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
assert('normal calculation', normal.calculatedAmount === 2_000_000, String(normal.calculatedAmount));

const multiYear = calculateMehrPure(
  {
    amount: 5_000_000,
    currency: 'IRR',
    contractYear: 1388,
    basisType: 'payment',
    paymentYear: 1400
  },
  testStore,
  'test-mehr-index-fixture-v1'
);
assert(
  'multi-year gap contract 1388 payment 1400',
  multiYear.contractIndex === 80 &&
    multiYear.paymentIndex === 200 &&
    multiYear.calculatedAmount === 12_500_000,
  String(multiYear.calculatedAmount)
);
assert('normal IRR currency', normal.currency === 'IRR' && normal.inputCurrency === 'IRR');
assert('response formula contract', normal.formula === 'M × I_prev / I_contract');
assert('paymentBasis field', normal.paymentBasis === 'payment');
assert('appliedIndexYearNumerator 1399', normal.appliedIndexYearNumerator === 1399);

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
  'same-year edge',
  sameYear.appliedIndexYearNumerator === 1399 && sameYear.calculatedAmount === 40_000_000,
  String(sameYear.calculatedAmount)
);
assert('coverage indexed years', normal.coverage?.indexedYearCount === testStore.yearToIndex.size);

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
assert('IRT → IRR', toman.amountInRial === 1_000_000 && toman.calculatedAmount === 2_000_000);

const contractMin = calculateMehrPure(
  {
    amount: 1_000_000,
    currency: 'IRR',
    contractYear: MIN_YEAR,
    basisType: 'payment',
    paymentYear: 1400
  },
  auditStore
);
assert('contractYear min 1315', contractMin.contractYear === MIN_YEAR);

const contract1401 = calculateMehrPure(
  {
    amount: 1_000_000,
    currency: 'IRR',
    contractYear: MAX_YEAR,
    basisType: 'payment',
    paymentYear: 1402
  },
  auditStore
);
assert('contractYear 1401', contract1401.contractYear === 1401 && contract1401.appliedIndexYearNumerator === 1401);

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

assert('deterministic rounding helper', roundCalculatedAmount(1.4) === 1 && roundCalculatedAmount(1.6) === 2);

const fracStore = new MehrIndexStore(
  new Map([
    [1390, 100],
    [1399, 150]
  ]),
  []
);
const frac = calculateMehrPure(
  {
    amount: 1_000_001,
    currency: 'IRR',
    contractYear: 1390,
    basisType: 'payment',
    paymentYear: 1400
  },
  fracStore,
  'frac-test'
);
assert(
  'fractional raw preserved',
  frac.calculatedAmountRaw === 1_500_001.5 && frac.calculatedAmount === 1_500_001.5,
  String(frac.calculatedAmountRaw)
);
assert('rounding metadata object', frac.rounding?.policy === 'no_official_statutory_rounding');

expectValidation('zero amount', () =>
  calculateMehrPure(
    { amount: 0, currency: 'IRR', contractYear: 1390, basisType: 'payment', paymentYear: 1400 },
    testStore
  )
);
expectValidation('negative amount', () =>
  calculateMehrPure(
    { amount: -1, currency: 'IRR', contractYear: 1390, basisType: 'payment', paymentYear: 1400 },
    testStore
  )
);
expectValidation('invalid amount NaN', () => parsePositiveAmount('abc', 'IRR'));
expectValidation('invalid currency', () => parsePositiveAmount(100, 'USD'));
expectValidation('invalid contract year low', () =>
  calculateMehrPure(
    { amount: 1, currency: 'IRR', contractYear: 999, basisType: 'payment', paymentYear: 1400 },
    testStore
  )
);
expectValidation('contract year after reference', () =>
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
expectValidation('missing payment data', () =>
  calculateMehrPure(
    { amount: 1_000_000, currency: 'IRR', contractYear: 1390, basisType: 'payment' },
    testStore
  )
);
expectValidation('missing deathDate', () =>
  calculateMehrPure(
    { amount: 1_000_000, currency: 'IRR', contractYear: 1390, basisType: 'death' },
    testStore
  )
);

expectIndexMissing('missing contract index', () =>
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
try {
  calculateMehrPure(
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1370,
      basisType: 'payment',
      paymentYear: 1400
    },
    testStore
  );
} catch (e) {
  assert(
    'missing contract year in details',
    e.details?.missingYears?.includes(1370),
    String(e.details?.missingYears)
  );
}

expectIndexMissing('missing numerator index paymentYear 1403', () =>
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

expectValidation('paymentDate and paymentYear conflict', () =>
  calculateMehrPure(
    {
      amount: 1,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'payment',
      paymentDate: '1400-01-01',
      paymentYear: 1400
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
assert('paymentYear 1402 PASS', pay1402.appliedIndexYearNumerator === 1401);

expectIndexMissing('paymentYear 1403 INDEX_NOT_AVAILABLE', () =>
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

expectIndexMissing('unsupported future index paymentYear 1405', () =>
  calculateMehrPure(
    {
      amount: 10_000_000,
      currency: 'IRR',
      contractYear: 1400,
      basisType: 'payment',
      paymentYear: 1405
    },
    testStore
  )
);

const death1402 = calculateMehrPure(
  {
    amount: 10_000_000,
    currency: 'IRR',
    contractYear: 1395,
    basisType: 'death',
    deathDate: '1402-06-01'
  },
  auditStore
);
assert('deathYear 1402 PASS', death1402.appliedIndexYearNumerator === 1401);

expectIndexMissing('deathYear 1403 INDEX_NOT_AVAILABLE', () =>
  calculateMehrPure(
    {
      amount: 10_000_000,
      currency: 'IRR',
      contractYear: 1395,
      basisType: 'death',
      deathDate: '1403-01-01'
    },
    auditStore
  )
);

expectValidation('overflow amount in rial', () =>
  calculateMehrPure(
    {
      amount: Number.MAX_SAFE_INTEGER,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'payment',
      paymentYear: 1400
    },
    testStore
  )
);

expectValidation('overflow calculated raw', () => {
  const hugeStore = new MehrIndexStore(
    new Map([
      [1390, 1],
      [1399, Number.MAX_SAFE_INTEGER]
    ]),
    []
  );
  calculateMehrPure(
    {
      amount: Number.MAX_SAFE_INTEGER - 1,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'payment',
      paymentYear: 1400
    },
    hugeStore
  );
});

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
