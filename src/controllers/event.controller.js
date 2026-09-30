const service = require('../services/event.service');
const { ok } = require('../utils/response');

async function list(req, res) { return ok(res, await service.listEvents(req.user, req.query)); }
async function get(req, res) { return ok(res, await service.getEvent(req.params.id, req.user)); }
async function create(req, res) { return ok(res, await service.createEvent(req.body, req.user), 201); }
async function update(req, res) { return ok(res, await service.updateEvent(req.params.id, req.body, req.user)); }
async function remove(req, res) { return ok(res, await service.deleteEvent(req.params.id, req.user)); }

module.exports = { list, get, create, update, remove };
