const service = require('../services/caseClientAccess.service');
const { ok } = require('../utils/response');

async function invite(req, res) {
  const caseId = Number(req.params.caseId);
  const clientId = Number(req.body.clientId ?? req.body.client_id);
  const data = await service.inviteClientToCase(caseId, clientId, req.user);
  return ok(res, data, 201);
}

async function list(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listCaseClientAccess(caseId, req.user));
}

async function revoke(req, res) {
  const caseId = Number(req.params.caseId);
  const accessId = Number(req.params.accessId);
  return ok(res, await service.revokeCaseClientAccess(caseId, accessId, req.user));
}

module.exports = { invite, list, revoke };
