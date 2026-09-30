const aiService = require('../services/ai.service');
const { ok } = require('../utils/response');

async function chat(req, res) {
  return ok(res, await aiService.chat(req.user, req.body || {}));
}

async function status(req, res) {
  return ok(res, await aiService.getAiStatus(req.user));
}

module.exports = { chat, status };
