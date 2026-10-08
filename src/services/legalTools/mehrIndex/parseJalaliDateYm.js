const jalaali = require('jalaali-js');
const { AppError } = require('../../../utils/response');

/**
 * Jalali date YYYY-MM-DD — validated with jalaali-js; reference year from jalali year.
 */
function parseJalaliDateYm(raw, fieldLabel) {
  const s = String(raw ?? '').trim();
  if (!s) {
    throw new AppError(`${fieldLabel} الزامی است`, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError(`${fieldLabel} باید به صورت YYYY-MM-DD (شمسی) باشد`, 400);
  }
  const [yStr, mStr, dStr] = s.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!jalaali.isValidJalaaliDate(year, month, day)) {
    throw new AppError(`${fieldLabel} در تقویم شمسی معتبر نیست`, 400);
  }
  return { date: s, year };
}

module.exports = { parseJalaliDateYm };
