const { AppError } = require('../../../utils/response');

/**
 * Parse jalali death date — YYYY-MM-DD; year is the first segment (no Gregorian conversion in v1).
 * @param {string} raw
 * @returns {{ deathDate: string, deathYear: number }}
 */
function parseJalaliDeathDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) {
    throw new AppError('deathDate الزامی است', 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError('deathDate باید به صورت YYYY-MM-DD (شمسی) باشد', 400);
  }
  const [yStr, mStr, dStr] = s.split('-');
  const deathYear = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!Number.isInteger(deathYear) || deathYear < 1200 || deathYear > 1500) {
    throw new AppError('سال فوت در deathDate نامعتبر است', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('ماه deathDate نامعتبر است', 400);
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new AppError('روز deathDate نامعتبر است', 400);
  }
  return { deathDate: s, deathYear };
}

module.exports = { parseJalaliDeathDate };
