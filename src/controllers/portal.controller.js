const service = require('../services/caseClientAccess.service');
const authService = require('../services/auth.service');
const tokenService = require('../services/clientInvitationToken.service');
const { ok } = require('../utils/response');
const { AppError } = require('../utils/response');

function meta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

function requireClientRole(user) {
  if (!user || user.role !== 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
}

async function register(req, res) {
  const data = await authService.registerClient(req.body || {}, meta(req));
  return ok(res, data, 201);
}

async function login(req, res) {
  const data = await authService.login(req.body || {}, meta(req));
  if (data.mfaRequired || data.mfaSetupRequired) {
    throw new AppError('ورود موکل از این مسیر پشتیبانی نمی‌شود', 403);
  }
  const role = data.user?.role || data.role;
  if (role !== 'client') {
    throw new AppError('این ورود فقط برای حساب موکل است', 403);
  }
  return ok(res, data);
}

async function listCases(req, res) {
  requireClientRole(req.user);
  return ok(res, await service.listPortalCases(req.user));
}

async function getCase(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.id);
  return ok(res, await service.getPortalCase(caseId, req.user));
}

async function acceptAccess(req, res) {
  requireClientRole(req.user);
  const accessId = Number(req.params.accessId);
  return ok(res, await service.acceptClientAccess(accessId, req.user));
}

async function listPendingInvites(req, res) {
  requireClientRole(req.user);
  return ok(res, await service.listMyPendingInvites(req.user));
}

async function getInviteStatus(req, res) {
  const raw = String(req.params.token || '').trim();
  return ok(res, await tokenService.getPublicInviteStatus(raw));
}

async function acceptInviteByToken(req, res) {
  requireClientRole(req.user);
  const raw = String(req.params.token || '').trim();
  return ok(res, await service.acceptClientAccessByToken(raw, req.user));
}

module.exports = {
  register,
  login,
  listCases,
  getCase,
  acceptAccess,
  listPendingInvites,
  getInviteStatus,
  acceptInviteByToken
};
