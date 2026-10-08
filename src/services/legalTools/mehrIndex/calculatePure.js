const { AppError } = require('../../../utils/response');
const { MIN_YEAR, MAX_YEAR } = require('./constants');
const { parseJalaliDeathDate } = require('./parseJalaliDeathDate');

const MAX_AMOUNT_IRR = Number.MAX_SAFE_INTEGER;
const FORMULA_LABEL = 'M × I_prev ÷ I_contract';

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
  const amountInIRR = cur === 'IRT' ? Math.round(n * 10) : Math.round(n);
  if (amountInIRR <= 0 || amountInIRR > MAX_AMOUNT_IRR) {
    throw new AppError('مبلغ مهریه خارج از محدوده مجاز است', 400);
  }
  return { originalAmount: n, inputCurrency: cur, amountInIRR };
}

function parseJalaliYear(raw, label) {
  if (raw === '' || raw == null) {
    throw new AppError(`${label} الزامی است`, 400);
  }
  const y = Number(raw);
  if (!Number.isFinite(y) || !Number.isInteger(y)) {
    throw new AppError(`${label} باید سال شمسی (عدد صحیح) باشد`, 400);
  }
  if (y < 1200 || y > 1500) {
    throw new AppError(`${label} خارج از محدوده مجاز است`, 400);
  }
  return y;
}

/**
 * Resolve indices for contract year and numerator year; single error with all missing years.
 * @param {import('./indexStore').MehrIndexStore} indexStore
 * @param {number} contractYear
 * @param {number} indexYearNumerator
 */
function resolveIndices(indexStore, contractYear, indexYearNumerator) {
  const missing = [];
  if (!indexStore.yearToIndex.has(contractYear)) missing.push(contractYear);
  if (!indexStore.yearToIndex.has(indexYearNumerator)) missing.push(indexYearNumerator);
  if (missing.length) {
    throw new AppError('شاخص رسمی موردنیاز برای سال موردنظر در سامانه موجود نیست.', 422, {
      code: 'LEGAL_DATA_NOT_AVAILABLE',
      dataKind: 'mehr_annual_index',
      missingYears: [...new Set(missing)].sort((a, b) => a - b)
    });
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

/** Deterministic rounding: nearest integer Rial. */
function roundCalculatedAmount(raw) {
  if (!Number.isFinite(raw)) {
    throw new AppError('خطا در محاسبه مبلغ', 500);
  }
  return Math.round(raw);
}

/**
 * Pure mehr calculation — no HTTP.
 *
 * Death reference year: deathYear; numerator index year = referenceYear - 1 (spec interpretation — adjust if official procedure differs).
 *
 * @param {object} input
 * @param {import('./indexStore').MehrIndexStore} indexStore
 * @param {string} [datasetVersion]
 */
function calculateMehrPure(input, indexStore, datasetVersion = null) {
  const body = input || {};
  const { amountInIRR, originalAmount, inputCurrency } = parsePositiveAmount(
    body.amount,
    body.currency
  );
  const contractYear = parseJalaliYear(body.contractYear, 'سال وقوع عقد');
  const basisType = String(body.basisType ?? '').trim();
  if (basisType !== 'payment' && basisType !== 'death') {
    throw new AppError('basisType باید payment یا death باشد', 400);
  }

  let referenceYear;
  let paymentYear = null;
  let deathYear = null;
  let deathDate = null;

  if (basisType === 'payment') {
    if (body.deathDate != null && body.deathDate !== '') {
      throw new AppError('در مبنای پرداخت، deathDate مجاز نیست', 400);
    }
    paymentYear = parseJalaliYear(body.paymentYear, 'سال پرداخت');
    referenceYear = paymentYear;
  } else {
    if (body.paymentYear != null && body.paymentYear !== '') {
      throw new AppError('در مبنای فوت، paymentYear مجاز نیست', 400);
    }
    const parsed = parseJalaliDeathDate(body.deathDate);
    deathDate = parsed.deathDate;
    deathYear = parsed.deathYear;
    referenceYear = deathYear;
  }

  if (contractYear > referenceYear) {
    throw new AppError('سال وقوع عقد نمی‌تواند بعد از سال مبنای محاسبه باشد', 400);
  }

  const indexYearNumerator = referenceYear - 1;
  const { contractIndex, paymentIndex } = resolveIndices(
    indexStore,
    contractYear,
    indexYearNumerator
  );

  const calculatedAmountRaw = (amountInIRR * paymentIndex) / contractIndex;
  if (!Number.isFinite(calculatedAmountRaw) || calculatedAmountRaw > MAX_AMOUNT_IRR) {
    throw new AppError('مبلغ محاسبه‌شده خارج از محدوده مجاز است', 400);
  }
  const calculatedAmount = roundCalculatedAmount(calculatedAmountRaw);

  const version =
    datasetVersion ||
    (indexStore.records && indexStore.records[0]?.dataset_version) ||
    (indexStore.records && indexStore.records[0]?.datasetVersion) ||
    null;

  return {
    originalAmount,
    inputCurrency,
    amountInIRR,
    contractYear,
    basisType,
    paymentYear,
    deathYear,
    deathDate,
    referenceYear,
    indexYearNumerator,
    contractIndex,
    paymentIndex,
    calculatedAmount,
    calculatedAmountRaw,
    formula: FORMULA_LABEL,
    datasetVersion: version,
    coverage: { minYear: MIN_YEAR, maxYear: MAX_YEAR },
    disclaimer:
      'این ابزار صرفاً یک ابزار محاسباتی/کمکی است و جایگزین مشاوره حقوقی یا تصمیم مرجع قضایی نیست. محاسبه فقط بر اساس شاخص‌های ثبت‌شده در سامانه انجام می‌شود.',
    notes: [
      'مهریه سکه در این نسخه پشتیبانی نمی‌شود.',
      'موضوع ۱۱۰ سکه مربوط به ضمانت اجرای وصول است و با محاسبه ارزش روز مهریه وجه رایج متفاوت است.'
    ]
  };
}

module.exports = {
  calculateMehrPure,
  parsePositiveAmount,
  parseJalaliYear,
  roundCalculatedAmount,
  FORMULA_LABEL
};
