const service = require('../services/template.service');
const { ok } = require('../utils/response');

async function list(req, res) {
  return ok(res, await service.listTemplates(req.user, req.query));
}
async function get(req, res) {
  return ok(res, await service.getTemplate(req.params.id, req.user));
}
async function create(req, res) {
  return ok(res, await service.createTemplate(req.body, req.user), 201);
}
async function update(req, res) {
  return ok(res, await service.updateTemplate(req.params.id, req.body, req.user));
}
async function remove(req, res) {
  return ok(res, await service.deleteTemplate(req.params.id, req.user));
}
async function duplicate(req, res) {
  return ok(res, await service.duplicateTemplate(req.params.id, req.user, req.body), 201);
}
async function preview(req, res) {
  return ok(res, await service.previewTemplate(req.body, req.user));
}
async function listVariables(req, res) {
  const { ALLOWED_VARIABLES } = require('../services/templateVariables');
  return ok(res, { variables: ALLOWED_VARIABLES });
}

module.exports = { list, get, create, update, remove, duplicate, preview, listVariables };
