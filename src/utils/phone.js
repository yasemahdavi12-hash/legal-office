/** Normalize Iranian mobile for loose matching (digits only, trailing 10). */
function normalizePhone(value) {
  if (value == null || value === '') return '';
  let d = String(value).replace(/\D/g, '');
  if (d.startsWith('98') && d.length >= 12) d = '0' + d.slice(2);
  if (d.length > 10) d = d.slice(-10);
  return d;
}

function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}

module.exports = { normalizePhone, phonesMatch };
