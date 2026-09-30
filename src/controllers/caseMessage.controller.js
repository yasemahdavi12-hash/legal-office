const service = require('../services/caseMessage.service');
const { ok } = require('../utils/response');
const { AppError } = require('../utils/response');

function requireClientRole(user) {
  if (!user || user.role !== 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
}

async function listForLawyer(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listCaseMessages(caseId, req.user, req.query));
}

async function createForLawyer(req, res) {
  const caseId = Number(req.params.caseId);
  const body = req.body?.body;
  return ok(res, await service.createLawyerMessage(caseId, body, req.user), 201);
}

async function listForPortal(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listPortalCaseMessages(caseId, req.user, req.query));
}

async function unreadForLawyer(req, res) {
  const caseId = Number(req.params.caseId);
  const count = await service.countUnreadForLawyer(caseId, req.user);
  return ok(res, { unreadCount: count });
}

async function unreadForPortal(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.caseId);
  const count = await service.countUnreadForClient(caseId, req.user);
  return ok(res, { unreadCount: count });
}

async function markReadLawyer(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.markReadForLawyer(caseId, req.user));
}

async function markReadPortal(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.caseId);
  return ok(res, await service.markReadForClient(caseId, req.user));
}

async function createForPortal(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.caseId);
  const body = req.body?.body;
  return ok(res, await service.createClientMessage(caseId, body, req.user), 201);
}

module.exports = {
  listForLawyer,
  createForLawyer,
  listForPortal,
  createForPortal,
  unreadForLawyer,
  unreadForPortal,
  markReadLawyer,
  markReadPortal
};
