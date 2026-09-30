const { AppError } = require('../utils/response');

function getBag(req, source, field) {
  const bag = source === 'params' ? req.params : source === 'query' ? req.query : req.body;
  return { bag, value: bag ? bag[field] : undefined };
}

/**
 * Schema-based request validation.
 * options.requireAny: [['a','b']] — at least one field in each group must be present (body).
 */
function validate(schema, options = {}) {
  return (req, res, next) => {
    const errors = [];

    if (Array.isArray(options.requireAny)) {
      for (const group of options.requireAny) {
        const ok = group.some((field) => {
          const v = req.body?.[field];
          return v !== undefined && v !== null && String(v).trim() !== '';
        });
        if (!ok) errors.push(`یکی از فیلدهای «${group.join(' / ')}» الزامی است`);
      }
    }

    for (const [field, rules] of Object.entries(schema || {})) {
      const source = rules.in || 'body';
      const { bag, value: raw } = getBag(req, source, field);
      let value = raw;

      if (rules.trim && typeof value === 'string') {
        value = value.trim();
        if (bag) bag[field] = value;
      }

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} الزامی است`);
        continue;
      }
      if (value === undefined || value === null || value === '') continue;

      if (rules.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        errors.push(`${field} معتبر نیست`);
      }
      if (rules.type === 'id' || rules.type === 'int') {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) errors.push(`${field} نامعتبر است`);
        else if (bag) bag[field] = n;
      }
      if (rules.type === 'number') {
        const n = Number(value);
        if (Number.isNaN(n)) errors.push(`${field} باید عدد باشد`);
      }
      if (rules.minLength && String(value).length < rules.minLength) {
        errors.push(`${field} باید حداقل ${rules.minLength} کاراکتر باشد`);
      }
      if (rules.maxLength && String(value).length > rules.maxLength) {
        errors.push(`${field} بیش از حد طولانی است`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} نامعتبر است`);
      }
    }

    if (errors.length) return next(new AppError('خطای اعتبارسنجی', 400, errors));
    next();
  };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { validate, asyncHandler };
