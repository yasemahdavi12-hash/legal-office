const legalToolsService = require('../services/legalTools.service');
const { ok } = require('../utils/response');

async function list(req, res) {
  return ok(res, await legalToolsService.listTools(req.user));
}

async function detail(req, res) {
  return ok(res, await legalToolsService.getToolDetail(req.params.slug, req.user));
}

async function calculate(req, res) {
  return ok(res, await legalToolsService.runCalculation(req.params.slug, req.body || {}, req.user));
}

module.exports = { list, detail, calculate };
