const service = require('../services/baleInbox.service');
const { ok } = require('../utils/response');

async function threads(req, res) {
  return ok(res, await service.listThreads(req.user));
}

async function messages(req, res) {
  return ok(res, await service.listMessages(req.user, req.query));
}

async function markRead(req, res) {
  return ok(res, await service.markMessageRead(req.user, req.params.id));
}

async function reply(req, res) {
  return ok(res, await service.replyToChat(req.user, req.body));
}

module.exports = { threads, messages, markRead, reply };
