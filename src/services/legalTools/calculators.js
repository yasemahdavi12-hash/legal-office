const { AppError } = require('../../utils/response');
const mehrIndexService = require('../legal/mehrIndex.service');
const { calculateMehrPure, parseJalaliYear } = require('./mehrIndex/calculatePure');
const { parseJalaliDateYm } = require('./mehrIndex/parseJalaliDateYm');
const { INDEX_NOT_AVAILABLE_MESSAGE } = require('./mehrIndex/constants');

const FIELD_LABELS = {
  dateFrom: 'تاریخ اول',
  dateTo: 'تاریخ دوم',
  startDate: 'تاریخ شروع'
};

function parseIsoDate(raw, fieldName) {
  const label = FIELD_LABELS[fieldName] || fieldName;
  const s = String(raw ?? '').trim();
  if (!s) {
    throw new AppError(`${label} الزامی است`, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError(`${label} باید به صورت YYYY-MM-DD (میلادی) باشد`, 400);
  }
  const d = new Date(`${s}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${label} نامعتبر است`, 400);
  }
  const normalized = d.toISOString().slice(0, 10);
  if (normalized !== s) {
    throw new AppError(`${label} در تقویم میلادی معتبر نیست`, 400);
  }
  return d;
}

function parseIntegerField(raw, label, { min, max } = {}) {
  if (raw === '' || raw == null) {
    throw new AppError(`${label} الزامی است`, 400);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new AppError(`${label} باید عدد صحیح باشد`, 400);
  }
  if (min != null && n < min) {
    throw new AppError(`${label} خارج از محدوده مجاز است`, 400);
  }
  if (max != null && n > max) {
    throw new AppError(`${label} خارج از محدوده مجاز است`, 400);
  }
  return n;
}

function dateDiff({ dateFrom, dateTo }) {
  const from = parseIsoDate(dateFrom, 'dateFrom');
  const to = parseIsoDate(dateTo, 'dateTo');
  const ms = to.getTime() - from.getTime();
  const days = Math.round(ms / 86400000);
  const forward = days >= 0;
  return {
    days,
    absDays: Math.abs(days),
    direction: forward ? 'forward' : 'backward',
    dateFrom: String(dateFrom).trim(),
    dateTo: String(dateTo).trim(),
    calendar: 'gregorian',
    note:
      'فاصله بر اساس روز تقویمی میلادی (UTC noon) محاسبه شده است؛ جایگزین مهلت قانونی یا تعطیلات رسمی نیست.'
  };
}

const DEADLINE_DAY_LIMIT = 36500;

function deadlineAdd({ startDate, daysToAdd }) {
  const start = parseIsoDate(startDate, 'startDate');
  const n = parseIntegerField(daysToAdd, 'تعداد روز', {
    min: -DEADLINE_DAY_LIMIT,
    max: DEADLINE_DAY_LIMIT
  });
  const end = new Date(start.getTime() + n * 86400000);
  const endStr = end.toISOString().slice(0, 10);
  const startNorm = String(startDate).trim();
  let directionNote;
  if (n > 0) {
    directionNote = `${n} روز به تاریخ شروع اضافه شد.`;
  } else if (n < 0) {
    directionNote = `${Math.abs(n)} روز از تاریخ شروع کم شد.`;
  } else {
    directionNote = 'تاریخ پایان با تاریخ شروع یکسان است (۰ روز).';
  }
  return {
    startDate: startNorm,
    daysToAdd: n,
    endDate: endStr,
    calendar: 'gregorian',
    direction: n >= 0 ? 'forward' : 'backward',
    note: `محاسبه بر اساس روز تقویمی میلادی (UTC noon). ${directionNote}`
  };
}

function delayInterestUserRate({ principal, annualRatePercent, days }) {
  const p = Number(principal);
  if (principal === '' || principal == null || !Number.isFinite(p) || p <= 0) {
    throw new AppError('اصل بدهی باید عدد مثبت باشد', 400);
  }
  const rate = Number(annualRatePercent);
  if (annualRatePercent === '' || annualRatePercent == null || !Number.isFinite(rate) || rate < 0 || rate > 1000) {
    throw new AppError('نرخ سالانه باید عددی بین ۰ تا ۱۰۰۰ باشد', 400);
  }
  const d = parseIntegerField(days, 'تعداد روز', { min: 0, max: DEADLINE_DAY_LIMIT });
  const interest = (p * (rate / 100) * d) / 365;
  const interestAmount = Math.round(interest * 100) / 100;
  const totalAmount = Math.round((p + interestAmount) * 100) / 100;
  return {
    principal: p,
    annualRatePercent: rate,
    days: d,
    interestAmount,
    totalAmount,
    formula: 'principal × (rate/100) × (days/365)',
    note:
      'این محاسبه بر اساس نرخ واردشده توسط کاربر انجام شده و به‌تنهایی به معنی تعیین نرخ قانونی خسارت تأخیر تأدیه نیست.'
  };
}

function missingYearsWhenNoStore(body) {
  const b = body || {};
  const contractYear = parseJalaliYear(b.contractYear, 'سال وقوع عقد');
  const basisType = String(b.basisType ?? '').trim();
  let referenceYear;
  if (basisType === 'payment') {
    if (b.paymentDate) {
      referenceYear = parseJalaliDateYm(b.paymentDate, 'تاریخ پرداخت').year;
    } else {
      referenceYear = parseJalaliYear(b.paymentYear, 'سال پرداخت');
    }
  } else if (basisType === 'death') {
    referenceYear = parseJalaliDateYm(b.deathDate, 'تاریخ فوت').year;
  } else {
    throw new AppError('basisType باید payment یا death باشد', 400);
  }
  const indexYearNumerator = referenceYear - 1;
  return [...new Set([contractYear, indexYearNumerator])].sort((a, b) => a - b);
}

async function mehrCalc(body) {
  const store = await mehrIndexService.getStore();
  if (!store) {
    const missingYears = missingYearsWhenNoStore(body);
    throw new AppError(INDEX_NOT_AVAILABLE_MESSAGE, 422, {
      code: 'INDEX_NOT_AVAILABLE',
      datasetEmpty: true,
      missingYears
    });
  }
  const datasetVersion = await mehrIndexService.getDatasetVersion();
  return calculateMehrPure(body || {}, store, datasetVersion);
}

const SYNC_HANDLERS = {
  'date-diff': dateDiff,
  'deadline-add': deadlineAdd,
  'delay-interest-user-rate': delayInterestUserRate
};

const ASYNC_HANDLERS = {
  'mehr-calc': mehrCalc
};

async function calculate(slug, body) {
  if (ASYNC_HANDLERS[slug]) {
    return ASYNC_HANDLERS[slug](body || {});
  }
  const fn = SYNC_HANDLERS[slug];
  if (!fn) {
    throw new AppError('این ابزار هنوز فعال نیست', 400, { code: 'TOOL_NOT_READY' });
  }
  return fn(body || {});
}

module.exports = {
  calculate,
  calculateMehrieh: mehrCalc,
  dateDiff,
  deadlineAdd,
  delayInterestUserRate,
  parseIsoDate,
  DEADLINE_DAY_LIMIT
};
