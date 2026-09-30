const mfaService = require('../services/mfa.service');
const authService = require('../services/auth.service');
const { ok } = require('../utils/response');

function meta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

async function setup(req, res) {
  return ok(res, await mfaService.beginSetup(req.user, meta(req)));
}

async function enable(req, res) {
  return ok(res, await mfaService.enable(req.user, req.body || {}, meta(req)));
}

async function disable(req, res) {
  if (req.user && req.user.mfa_setup_only) {
    const { AppError } = require('../utils/response');
    throw new AppError('پس از فعال‌سازی MFA از این مسیر استفاده کنید', 403);
  }
  return ok(res, await mfaService.disable(req.user, req.body || {}, meta(req)));
}

async function verify(req, res) {
  const data = await mfaService.verifyLoginChallenge(
    req.body || {},
    meta(req),
    authService.issueTokens
  );
  return ok(res, data);
}

async function status(req, res) {
  const db = require('../db/connection');
  const row = await db('users').where({ id: req.user.id }).first();
  return ok(res, mfaService.statusForUser(row || {}));
}

module.exports = { setup, enable, disable, verify, status };
