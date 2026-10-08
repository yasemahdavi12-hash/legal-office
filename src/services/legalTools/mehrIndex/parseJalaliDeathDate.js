const { parseJalaliDateYm } = require('./parseJalaliDateYm');

/** @deprecated use parseJalaliDateYm */
function parseJalaliDeathDate(raw) {
  const { date, year } = parseJalaliDateYm(raw, 'تاریخ فوت');
  return { deathDate: date, deathYear: year };
}

module.exports = { parseJalaliDeathDate };
