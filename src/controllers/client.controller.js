const service = require('../services/client.service');
const { ok } = require('../utils/response');

async function list(req, res) { return ok(res, await service.listClients(req.user, req.query)); }
async function get(req, res) { return ok(res, await service.getClient(req.params.id, req.user)); }
async function create(req, res) { return ok(res, await service.createClient(req.body, req.user), 201); }
async function update(req, res) { return ok(res, await service.updateClient(req.params.id, req.body, req.user)); }
async function remove(req, res) { return ok(res, await service.deleteClient(req.params.id, req.user)); }

module.exports = { list, get, create, update, remove };
