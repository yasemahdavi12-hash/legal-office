const passwordResetService = require('../services/passwordReset.service');
const { ok } = require('../utils/response');

function meta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

async function forgotPassword(req, res) {
  const data = await passwordResetService.forgotPassword(req.body, meta(req));
  return ok(res, data);
}

async function verifyOtp(req, res) {
  const data = await passwordResetService.verifyOtp(req.body, meta(req));
  return ok(res, data);
}

async function resetPassword(req, res) {
  const data = await passwordResetService.resetPassword(req.body, meta(req));
  return ok(res, data);
}

module.exports = { forgotPassword, verifyOtp, resetPassword };
