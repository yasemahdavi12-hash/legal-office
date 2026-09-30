const service = require('../services/caseDocumentRequest.service');
const { ok } = require('../utils/response');
const { AppError } = require('../utils/response');

function requireClientRole(user) {
  if (!user || user.role !== 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
}

async function create(req, res) {
  const caseId = Number(req.params.caseId);
  const clientId = Number(req.body.clientId ?? req.body.client_id);
  const data = await service.createRequest(caseId, {
    clientId,
    title: req.body.title,
    description: req.body.description
  }, req.user);
  return ok(res, data, 201);
}

async function listLawyer(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listRequestsForLawyer(caseId, req.user));
}

async function approve(req, res) {
  const caseId = Number(req.params.caseId);
  const requestId = Number(req.params.requestId);
  return ok(res, await service.approveRequest(caseId, requestId, req.user));
}

async function reject(req, res) {
  const caseId = Number(req.params.caseId);
  const requestId = Number(req.params.requestId);
  const reason = req.body.rejectionReason ?? req.body.rejection_reason ?? req.body.reason;
  return ok(res, await service.rejectRequest(caseId, requestId, reason, req.user));
}

async function cancel(req, res) {
  const caseId = Number(req.params.caseId);
  const requestId = Number(req.params.requestId);
  return ok(res, await service.cancelRequest(caseId, requestId, req.user));
}

async function listPortal(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listRequestsForClient(caseId, req.user));
}

async function submitPortal(req, res) {
  requireClientRole(req.user);
  const caseId = Number(req.params.caseId);
  const requestId = Number(req.params.requestId);
  const data = await service.submitRequest(caseId, requestId, req.file, req.user, { ip: req.ip });
  return ok(res, data);
}

module.exports = {
  create,
  listLawyer,
  approve,
  reject,
  cancel,
  listPortal,
  submitPortal
};
