const { AppError } = require('../../utils/response');

function parseIsoDate(raw, fieldName) {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError(`${fieldName} باید به صورت YYYY-MM-DD باشد`, 400);
  }
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`${fieldName} نامعتبر است`, 400);
  }
  return d;
}

function dateDiff({ dateFrom, dateTo }) {
  const from = parseIsoDate(dateFrom, 'dateFrom');
  const to = parseIsoDate(dateTo, 'dateTo');
  const ms = to.getTime() - from.getTime();
  const days = Math.round(ms / 86400000);
  return {
    days,
    absDays: Math.abs(days),
    direction: days >= 0 ? 'forward' : 'backward',
    dateFrom: dateFrom,
    dateTo: dateTo,
    note: 'محاسبه بر اساس تقویم میلادی (UTC noon).'
  };
}

function deadlineAdd({ startDate, daysToAdd }) {
  const start = parseIsoDate(startDate, 'startDate');
  const n = Number(daysToAdd);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new AppError('daysToAdd باید عدد صحیح باشد', 400);
  }
  if (n < -36500 || n > 36500) {
    throw new AppError('daysToAdd خارج از محدوده مجاز است', 400);
  }
  const end = new Date(start.getTime() + n * 86400000);
  const endStr = end.toISOString().slice(0, 10);
  return {
    startDate,
    daysToAdd: n,
    endDate: endStr,
    note: 'مهلت قانونی را از متن قانون استخراج و به‌صورت تعداد روز وارد کنید.'
  };
}

function delayInterestUserRate({ principal, annualRatePercent, days }) {
  const p = Number(principal);
  const rate = Number(annualRatePercent);
  const d = Number(days);
  if (!Number.isFinite(p) || p <= 0) {
    throw new AppError('principal باید عدد مثبت باشد', 400);
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000) {
    throw new AppError('annualRatePercent نامعتبر است', 400);
  }
  if (!Number.isFinite(d) || d <= 0 || !Number.isInteger(d)) {
    throw new AppError('days باید عدد صحیح مثبت باشد', 400);
  }
  const interest = (p * (rate / 100) * d) / 365;
  const rounded = Math.round(interest * 100) / 100;
  return {
    principal: p,
    annualRatePercent: rate,
    days: d,
    interestAmount: rounded,
    formula: 'principal × (rate/100) × (days/365)',
    disclaimer: 'نرخ را خودتان از قانون/قرارداد وارد کرده‌اید؛ این سامانه نرخ رسمی تأخیر تأدیه را اعمال نمی‌کند.'
  };
}

const HANDLERS = {
  'date-diff': dateDiff,
  'deadline-add': deadlineAdd,
  'delay-interest-user-rate': delayInterestUserRate
};

function calculate(slug, body) {
  const fn = HANDLERS[slug];
  if (!fn) {
    throw new AppError('این ابزار هنوز فعال نیست', 400, { code: 'TOOL_NOT_READY' });
  }
  return fn(body || {});
}

module.exports = {
  calculate,
  dateDiff,
  deadlineAdd,
  delayInterestUserRate
};
