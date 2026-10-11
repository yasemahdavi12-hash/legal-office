const { AppError } = require('../utils/response');

/** Allowed {{placeholders}} — unknown tokens are reported, not silently removed. */
const ALLOWED_VARIABLES = Object.freeze([
  'lawyer_name',
  'lawyer_phone',
  'client_name',
  'client_national_id',
  'client_address',
  'case_number',
  'court_name',
  'opponent_name',
  'contract_date',
  'document_date',
  'claim_amount'
]);

const VAR_PATTERN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

function extractVariableNames(text) {
  const found = new Set();
  const s = String(text ?? '');
  let m;
  const re = new RegExp(VAR_PATTERN.source, 'gi');
  while ((m = re.exec(s)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

function classifyVariables(text) {
  const used = extractVariableNames(text);
  const allowedSet = new Set(ALLOWED_VARIABLES);
  const unknown = used.filter((v) => !allowedSet.has(v));
  const known = used.filter((v) => allowedSet.has(v));
  return { used, known, unknown, allowed: [...ALLOWED_VARIABLES] };
}

function renderTemplateBody(text, values = {}) {
  const map = values && typeof values === 'object' ? values : {};
  return String(text ?? '').replace(VAR_PATTERN, (_, name) => {
    const key = String(name).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(map, key) && map[key] != null && String(map[key]).trim() !== '') {
      return String(map[key]);
    }
    return `{{${key}}}`;
  });
}

function findUnfilledVariables(text, values = {}) {
  const rendered = renderTemplateBody(text, values);
  return extractVariableNames(rendered);
}

function sanitizeTemplateBody(raw) {
  let s = String(raw ?? '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript:/gi, '');
  return s;
}

function assertBodySafe(raw) {
  const s = String(raw ?? '');
  if (/<script/i.test(s) || /\son\w+\s*=/i.test(s) || /javascript:/i.test(s)) {
    throw new AppError('متن قالب شامل محتوای غیرمجاز (اسکریپت) است', 400, { code: 'TEMPLATE_UNSAFE' });
  }
}

module.exports = {
  ALLOWED_VARIABLES,
  extractVariableNames,
  classifyVariables,
  renderTemplateBody,
  findUnfilledVariables,
  sanitizeTemplateBody,
  assertBodySafe
};
