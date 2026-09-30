const authService = require('../services/auth.service');
const { ok } = require('../utils/response');

function meta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

async function login(req, res) {
  const data = await authService.login(req.body, meta(req));
  return ok(res, data);
}

async function register(req, res) {
  const data = await authService.register(req.body, meta(req));
  return ok(res, data, 201);
}

async function refresh(req, res) {
  const data = await authService.refresh(req.body.refreshToken || req.body.refresh_token, meta(req));
  return ok(res, data);
}

async function logout(req, res) {
  const data = await authService.logout(req.body.refreshToken || req.body.refresh_token, req.user?.id);
  return ok(res, data);
}

async function me(req, res) {
  return ok(res, await authService.getProfile(req.user.id));
}

async function updateMe(req, res) {
  return ok(res, await authService.updateProfile(req.user.id, req.body || {}, meta(req)));
}

async function changePassword(req, res) {
  return ok(res, await authService.changePassword(req.user.id, req.body || {}, meta(req)));
}

module.exports = { login, register, refresh, logout, me, updateMe, changePassword };
