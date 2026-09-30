const service = require('../services/case.service');
const { ok } = require('../utils/response');

const meta = (req) => ({ ip: req.ip });

async function list(req, res) {
  return ok(res, await service.listCases(req.user, req.query));
}
async function get(req, res) {
  return ok(res, await service.getCase(req.params.id, req.user));
}
async function create(req, res) {
  return ok(res, await service.createCase(req.body, req.user, meta(req)), 201);
}
async function update(req, res) {
  return ok(res, await service.updateCase(req.params.id, req.body, req.user, meta(req)));
}
async function remove(req, res) {
  return ok(res, await service.deleteCase(req.params.id, req.user, meta(req)));
}

module.exports = { list, get, create, update, remove };
