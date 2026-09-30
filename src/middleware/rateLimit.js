const { AppError } = require('../utils/response');
const { getRateLimitStore } = require('./rateLimitStore');

/**
 * Rate limiter. Production store is Redis-only (fail-closed on Redis errors).
 * Development may use Memory store.
 */
function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 20,
  message = 'تعداد درخواست بیش از حد مجاز است',
  keyGenerator
} = {}) {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  return async (req, res, next) => {
    try {
      const store = getRateLimitStore();
      const baseKey = keyGenerator
        ? keyGenerator(req)
        : `${req.ip}|${req.baseUrl || ''}${req.path}`;

      let result;
      try {
        result = await store.incr(baseKey, windowMs);
      } catch (err) {
        if (isProd) {
          return next(new AppError('سرویس محدودیت نرخ در دسترس نیست', 503, {
            code: 'RATE_LIMIT_STORE_DOWN'
          }));
        }
        // Dev only: soft-fail open would be unsafe; use a one-off memory bump
        const { MemoryRateLimitStore } = require('./rateLimitStore');
        const mem = new MemoryRateLimitStore();
        result = await mem.incr(baseKey, windowMs);
      }

      const remaining = Math.max(0, max - result.count);
      const resetSec = Math.max(1, Math.ceil(result.resetMs / 1000));
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(resetSec));

      if (result.count > max) {
        res.setHeader('Retry-After', String(resetSec));
        return next(new AppError(message, 429));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { rateLimit };
