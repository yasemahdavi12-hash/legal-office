const { handleWebhookRequest } = require('../services/baleInbound.service');
const { ok } = require('../utils/response');

async function webhook(req, res) {
  const secret = String(req.params.secret || '').trim();
  const result = await handleWebhookRequest(secret, req.body);
  return ok(res, result);
}

module.exports = { webhook };
