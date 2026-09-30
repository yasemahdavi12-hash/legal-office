const service = require('../services/communication.service');
const { ok } = require('../utils/response');

async function list(req, res) { return ok(res, await service.listCommunications(req.user)); }
async function upsert(req, res) { return ok(res, await service.upsertSettings(req.user, req.body)); }
async function connect(req, res) { return ok(res, await service.connect(req.user, req.body)); }
async function disconnect(req, res) { return ok(res, await service.disconnect(req.user, req.body.platform || req.params.platform)); }
async function send(req, res) { return ok(res, await service.sendMessage(req.user, req.body)); }

module.exports = { list, upsert, connect, disconnect, send };
