const service = require('../services/note.service');
const { ok } = require('../utils/response');

async function list(req, res) { return ok(res, await service.listNotes(req.user, req.query)); }
async function get(req, res) { return ok(res, await service.getNote(req.params.id, req.user)); }
async function create(req, res) { return ok(res, await service.createNote(req.body, req.user), 201); }
async function update(req, res) { return ok(res, await service.updateNote(req.params.id, req.body, req.user)); }
async function remove(req, res) { return ok(res, await service.deleteNote(req.params.id, req.user)); }

module.exports = { list, get, create, update, remove };
