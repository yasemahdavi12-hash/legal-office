const service = require('../services/admin.service');
const { ok } = require('../utils/response');

async function dashboard(req, res) {
  return ok(res, await service.dashboard(req.user));
}
async function listUsers(req, res) {
  return ok(res, await service.listUsers());
}
async function createUser(req, res) {
  return ok(res, await service.createUser(req.body, req.user, { ip: req.ip }), 201);
}
async function updateUser(req, res) {
  return ok(res, await service.updateUser(req.params.id, req.body, req.user, { ip: req.ip }));
}
async function deleteUser(req, res) {
  return ok(res, await service.deleteUser(req.params.id, req.user, { ip: req.ip }));
}
async function auditLogs(req, res) {
  return ok(res, await service.listAuditLogs(req.query));
}

async function setUserSubscription(req, res) {
  return ok(res, await service.setUserSubscription(req.params.id, req.body, req.user, { ip: req.ip }));
}

module.exports = {
  dashboard,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  auditLogs,
  setUserSubscription
};
