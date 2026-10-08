const { AppError } = require('../../../utils/response');
const { MIN_YEAR, INDEX_NOT_AVAILABLE_MESSAGE } = require('./constants');
const { parseJalaliDateYm } = require('./parseJalaliDateYm');

const MAX_AMOUNT_IRR = Number.MAX_SAFE_INTEGER;
const FORMULA = 'M × I_prev / I_contract';
const FORMULA_FA = 'مبلغ × شاخص سال قبل از سال مرجع ÷ شاخص سال عقد';
const MEHR_DISCLAIMER =
  'این ابزار برای محاسبه کمکی مهریه وجه رایج بر اساس شاخص‌های رسمی واردشده در سامانه است و جایگزین مشاوره حقوقی یا تصمیم مرجع قضایی نیست.';
const MEHR_DISCLAIMER_SCOPE =
  'مهریه سکه و موضوع ضمانت اجرای ۱۱۰ سکه در این نسخه محاسبه نمی‌شود.';
const DEATH_BASIS_NOTE =
  'مبنای فوت/ترکه: شاخص صورت = شاخص سال قبل از سال فوت (deathCalendarYear − 1)؛ منطق ماده ۳ آیین‌نامه — تأیید نهایی با مرجع قضایی.';

const ROUNDING_METADATA = Object.freeze({
  policy: 'no_official_statutory_rounding',
  indicesUnrounded: true,
  intermediateUnrounded: true,
  amountField: 'calculatedAmount',
  note:
    'رویه رسمی واحد/گرد کردن مبلغ نهایی مهریه در این پیاده‌سازی یافت نشد؛ مبلغ خروجی همان حاصل دقیق ضرب/تقسیم بر شاخص‌های ذخیره‌شده است (ریال).'
});

function indexNotAvailable(missingYears) {
  throw new AppError(INDEX_NOT_AVAILABLE_MESSAGE, 422, {
    code: 'INDEX_NOT_AVAILABLE',
    missingYears: [...new Set(missingYears)].sort((a, b) => a - b)
  });
}

function parsePositiveAmount(amount, currency) {
  const cur = String(currency ?? 'IRR').trim().toUpperCase();
  if (cur !== 'IRR' && cur !== 'IRT') {
    throw new AppError('واحد پول باید IRR یا IRT باشد', 400);
  }
  if (amount === '' || amount == null) {
    throw new AppError('مبلغ مهریه الزامی است', 400);
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    throw new AppError('مبلغ مهریه باید عدد معتبر باشد', 400);
  }
  if (n <= 0) {
    throw new AppError('مبلغ مهریه باید عدد مثبت باشد', 400);
  }
  const amountInRial = cur === 'IRT' ? Math.round(n * 10) : Math.round(n);
  if (amountInRial <= 0 || amountInRial > MAX_AMOUNT_IRR) {
    throw new AppError('مبلغ مهریه خارج از محدوده مجاز است', 400);
  }
  return { originalAmount: n, inputCurrency: cur, amountInRial };
}

const CONTRACT_YEAR_MAX = 1450;

function parseContractYear(raw) {
  const y = parseJalaliYear(raw, 'سال وقوع عقد');
  if (y < MIN_YEAR || y > CONTRACT_YEAR_MAX) {
    throw new AppError(`سال وقوع عقد باید بین ${MIN_YEAR} و ${CONTRACT_YEAR_MAX} باشد`, 400);
  }
  return y;
}

function parseJalaliYear(raw, label) {
  if (raw === '' || raw == null) {
    throw new AppError(`${label} الزامی است`, 400);
  }
  const y = Number(raw);
  if (!Number.isFinite(y) || !Number.isInteger(y)) {
    throw new AppError(`${label} باید سال شمسی (عدد صحیح) باشد`, 400);
  }
  return y;
}

function resolveReferencePayment(body) {
  if (body.deathDate != null && body.deathDate !== '') {
    throw new AppError('در مبنای پرداخت، deathDate مجاز نیست', 400);
  }
  const hasDate = body.paymentDate != null && String(body.paymentDate).trim() !== '';
  const hasYear = body.paymentYear != null && body.paymentYear !== '';
  if (hasDate && hasYear) {
    throw new AppError('فقط یکی از paymentDate یا paymentYear مجاز است', 400);
  }
  let paymentDate = null;
  let paymentYear = null;
  if (hasDate) {
    const parsed = parseJalaliDateYm(body.paymentDate, 'تاریخ پرداخت');
    paymentDate = parsed.date;
    paymentYear = parsed.year;
  } else if (hasYear) {
    paymentYear = parseJalaliYear(body.paymentYear, 'سال پرداخت');
  } else {
    throw new AppError('سال پرداخت یا تاریخ پرداخت الزامی است', 400);
  }
  return { paymentDate, paymentYear, referenceYear: paymentYear };
}

function resolveReferenceDeath(body) {
  if (body.paymentYear != null && body.paymentYear !== '') {
    throw new AppError('در مبنای فوت، paymentYear مجاز نیست', 400);
  }
  if (body.paymentDate != null && body.paymentDate !== '') {
    throw new AppError('در مبنای فوت، paymentDate مجاز نیست', 400);
  }
  const parsed = parseJalaliDateYm(body.deathDate, 'تاریخ فوت');
  const deathYear = parsed.year;
  return { deathDate: parsed.date, deathYear, referenceYear: deathYear };
}

function resolveIndices(indexStore, contractYear, indexYearNumerator) {
  const missing = [];
  if (!indexStore.yearToIndex.has(contractYear)) missing.push(contractYear);
  if (!indexStore.yearToIndex.has(indexYearNumerator)) missing.push(indexYearNumerator);
  if (missing.length) {
    indexNotAvailable(missing);
  }
  const contractIndex = indexStore.yearToIndex.get(contractYear);
  const paymentIndex = indexStore.yearToIndex.get(indexYearNumerator);
  if (
    !Number.isFinite(contractIndex) ||
    contractIndex <= 0 ||
    !Number.isFinite(paymentIndex) ||
    paymentIndex <= 0
  ) {
    throw new AppError('داده شاخص نامعتبر است', 500, { code: 'INDEX_DATA_INTEGRITY' });
  }
  return { contractIndex, paymentIndex };
}

function buildCoverage(indexStore) {
  const years = indexStore?.yearToIndex ? [...indexStore.yearToIndex.keys()] : [];
  if (!years.length) {
    return { indexMinYear: null, indexMaxYear: null, indexedYearCount: 0 };
  }
  years.sort((a, b) => a - b);
  return {
    indexMinYear: years[0],
    indexMaxYear: years[years.length - 1],
    indexedYearCount: years.length
  };
}

function roundCalculatedAmount(raw) {
  if (!Number.isFinite(raw)) {
    throw new AppError('خطا در محاسبه مبلغ', 500);
  }
  return Math.round(raw);
}

/**
 * Pure mehrieh (cash) calculation.
 * Numerator index year = referenceYear - 1 (payment or death year per product spec / reg. art. 2–3).
 */
function calculateMehrPure(input, indexStore, datasetVersion = null) {
  const body = input || {};
  const { amountInRial, originalAmount, inputCurrency } = parsePositiveAmount(
    body.amount,
    body.currency
  );
  const contractYear = parseContractYear(body.contractYear);
  const basisType = String(body.basisType ?? '').trim();
  if (basisType !== 'payment' && basisType !== 'death') {
    throw new AppError('basisType باید payment یا death باشد', 400);
  }

  let paymentDate = null;
  let paymentYear = null;
  let deathDate = null;
  let deathYear = null;
  let referenceYear;

  if (basisType === 'payment') {
    ({ paymentDate, paymentYear, referenceYear } = resolveReferencePayment(body));
  } else {
    ({ deathDate, deathYear, referenceYear } = resolveReferenceDeath(body));
  }

  if (contractYear > referenceYear) {
    throw new AppError('سال وقوع عقد نمی‌تواند بعد از سال مبنای محاسبه باشد', 400);
  }

  const appliedIndexYearNumerator = referenceYear - 1;
  const appliedIndexYearDenominator = contractYear;
  const { contractIndex, paymentIndex } = resolveIndices(
    indexStore,
    contractYear,
    appliedIndexYearNumerator
  );

  const calculatedAmountRaw = (amountInRial * paymentIndex) / contractIndex;
  if (!Number.isFinite(calculatedAmountRaw) || calculatedAmountRaw > MAX_AMOUNT_IRR) {
    throw new AppError('مبلغ محاسبه‌شده خارج از محدوده مجاز است', 400);
  }
  const calculatedAmount = calculatedAmountRaw;

  const indexDatasetVersion =
    datasetVersion ||
    (indexStore.records && indexStore.records[0]?.dataset_version) ||
    (indexStore.records && indexStore.records[0]?.datasetVersion) ||
    null;

  const implementationNotes =
    basisType === 'death' ? [DEATH_BASIS_NOTE] : [];

  return {
    originalAmount,
    inputCurrency,
    currency: 'IRR',
    amountInRial,
    contractYear,
    basisType,
    paymentBasis: basisType,
    paymentDate,
    paymentYear,
    deathDate,
    deathYear,
    referenceYear,
    appliedIndexYearNumerator,
    appliedIndexYearDenominator,
    contractIndex,
    paymentIndex,
    calculatedAmount,
    calculatedAmountRaw,
    rounding: { ...ROUNDING_METADATA },
    formula: FORMULA,
    formulaFa: FORMULA_FA,
    indexDatasetVersion,
    coverage: buildCoverage(indexStore),
    disclaimer: `${MEHR_DISCLAIMER} ${MEHR_DISCLAIMER_SCOPE}`,
    implementationNotes
  };
}

function getMehrApiDisclaimer() {
  return `${MEHR_DISCLAIMER} ${MEHR_DISCLAIMER_SCOPE}`;
}

module.exports = {
  calculateMehrPure,
  parsePositiveAmount,
  parseJalaliYear,
  parseContractYear,
  roundCalculatedAmount,
  getMehrApiDisclaimer,
  MEHR_DISCLAIMER,
  MEHR_DISCLAIMER_SCOPE,
  FORMULA,
  FORMULA_FA,
  indexNotAvailable
};
