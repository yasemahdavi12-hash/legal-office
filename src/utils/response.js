class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function ok(res, data, status = 200) {
  return res.status(status).json(data);
}

function fail(res, error) {
  const status = error.status || 500;
  const body = { error: error.message || 'خطای سرور' };
  if (error.details) body.details = error.details;
  return res.status(status).json(body);
}

module.exports = { AppError, ok, fail };
