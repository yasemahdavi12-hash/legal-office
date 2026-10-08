const { AppError } = require('../../../utils/response');
const {
  MIN_YEAR,
  MAX_YEAR,
  MAX_REFERENCE_YEAR,
  INDEX_NOT_AVAILABLE_MESSAGE
} = require('./constants');
const { parseJalaliDateYm } = require('./parseJalaliDateYm');

const MAX_AMOUNT_IRR = Number.MAX_SAFE_INTEGER;
const FORMULA = 'M × I_prev / I_contract';
const FORMULA_FA = 'مبلغ × شاخص سال قبل از سال مرجع ÷ شاخص سال عقد';
const MEHR_DISCLAIMER =
  'این ابزار محاسبه‌ای کمکی است و جایگزین مشاوره حقوقی یا تصمیم مرجع قضایی نیست. محاسبه فقط بر اساس شاخص‌های رسمی واردشده در سامانه انجام می‌شود و در صورت نبود شاخص رسمی برای سال موردنیاز، نتیجه تخمینی ارائه نمی‌شود.';
const DEATH_BASIS_NOTE =
  'مبنای فوت/ترکه: شاخص صورت = شاخص سال قبل از سال فوت (deathYear − 1) مطابق پیاده‌سازی ماده ۳ آیین‌نامه (تأیید نهایی با مرجع قضایی).';

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

function parseContractYear(raw) {
  const y = parseJalaliYear(raw, 'سال وقوع عقد');
  if (y < MIN_YEAR || y > MAX_YEAR) {
    throw new AppError(`سال وقوع عقد باید بین ${MIN_YEAR} و ${MAX_YEAR} باشد`, 400);
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
  let paymentDate = null;
  let paymentYear = null;
  if (body.paymentDate != null && String(body.paymentDate).trim() !== '') {
    const parsed = parseJalaliDateYm(body.paymentDate, 'تاریخ پرداخت');
    paymentDate = parsed.date;
    paymentYear = parsed.year;
  } else if (body.paymentYear != null && body.paymentYear !== '') {
    paymentYear = parseJalaliYear(body.paymentYear, 'سال پرداخت');
  } else {
    throw new AppError('سال پرداخت یا تاریخ پرداخت الزامی است', 400);
  }
  if (paymentYear > MAX_REFERENCE_YEAR) {
    indexNotAvailable([paymentYear - 1]);
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
  if (deathYear > MAX_REFERENCE_YEAR) {
    indexNotAvailable([deathYear - 1]);
  }
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
  const calculatedAmount = roundCalculatedAmount(calculatedAmountRaw);

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
    rounding: 'integer_rial',
    formula: FORMULA,
    formulaFa: FORMULA_FA,
    indexDatasetVersion,
    coverage: {
      indexMinYear: MIN_YEAR,
      indexMaxYear: MAX_YEAR,
      maxReferenceYear: MAX_REFERENCE_YEAR
    },
    disclaimer: MEHR_DISCLAIMER,
    implementationNotes
  };
}

module.exports = {
  calculateMehrPure,
  parsePositiveAmount,
  parseJalaliYear,
  parseContractYear,
  roundCalculatedAmount,
  FORMULA,
  FORMULA_FA,
  indexNotAvailable
};
