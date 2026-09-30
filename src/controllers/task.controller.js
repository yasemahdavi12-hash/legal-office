const service = require('../services/task.service');
const { ok } = require('../utils/response');

async function list(req, res) { return ok(res, await service.listTasks(req.user, req.query)); }
async function get(req, res) { return ok(res, await service.getTask(req.params.id, req.user)); }
async function create(req, res) { return ok(res, await service.createTask(req.body, req.user), 201); }
async function update(req, res) { return ok(res, await service.updateTask(req.params.id, req.body, req.user)); }
async function remove(req, res) { return ok(res, await service.deleteTask(req.params.id, req.user)); }

module.exports = { list, get, create, update, remove };
