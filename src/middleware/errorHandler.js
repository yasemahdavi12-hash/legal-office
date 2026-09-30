const { fail, AppError } = require('../utils/response');
const { safeLog } = require('../utils/logger');
const config = require('../config');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (!(err instanceof AppError) && err.code === 'LIMIT_FILE_SIZE') {
    return fail(res, new AppError('حجم فایل بیش از حد مجاز است', 400));
  }
  if (!(err instanceof AppError) && (err.code === 'SQLITE_CONSTRAINT' || String(err.code || '').includes('CONSTRAINT'))) {
    return fail(res, new AppError('مغایرت با محدودیت پایگاه‌داده', 400));
  }

  const status = err.status || 500;
  const isAppError = err instanceof AppError;
  const isOperational = isAppError && status !== 500;

  if (isOperational) {
    return fail(res, err);
  }

  safeLog('[API]', err.message || 'internal error');
  if (!config.isProd && err.stack) {
    safeLog(err.stack);
  }

  // Never leak internal details to clients
  return fail(res, new AppError('خطای داخلی سرور', 500));
}

module.exports = { errorHandler };
