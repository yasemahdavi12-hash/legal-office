const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { parseJson, toJson } = require('../utils/dbHelpers');
const { safeLog } = require('../utils/logger');
const { decryptCommToken } = require('./communication.service');
const { baleApiCall } = require('./messengers/BaleService');

function generateWebhookSecret() {
  return crypto.randomBytes(24).toString('hex');
}

function buildWebhookUrl(secret) {
  const base = String(config.publicAppUrl || '').replace(/\/$/, '');
  return `${base}/api/communications/bale/webhook/${secret}`;
}

function canAutoRegisterWebhook() {
  if (!config.bale.webhookAutoRegister) return false;
  return /^https:\/\//i.test(String(config.publicAppUrl || ''));
}

/**
 * @param {object} update Bale/Telegram-style Update
 * @returns {object|null}
 */
function parseBaleUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  const msg = update.message || update.edited_message;
  if (!msg || msg.message_id == null) return null;
  const chatId = msg.chat?.id;
  if (chatId == null) return null;
  return {
    external_message_id: String(msg.message_id),
    chat_id: String(chatId),
    sender_id: msg.from?.id != null ? String(msg.from.id) : null,
    sender_username: msg.from?.username ? String(msg.from.username) : null,
    sender_first_name: msg.from?.first_name ? String(msg.from.first_name) : null,
    text: msg.text != null
      ? String(msg.text)
      : (msg.caption != null ? String(msg.caption) : null),
    update_id: update.update_id
  };
}

async function findCommunicationByWebhookSecret(secret) {
  const s = String(secret || '').trim();
  if (!s) return null;
  return db('communications')
    .where({ platform: 'bale', inbound_webhook_secret: s, is_connected: true })
    .first();
}

async function savePollOffset(communicationId, offset) {
  const row = await db('communications').where({ id: communicationId }).first();
  if (!row) return;
  const settings = parseJson(row.settings, {});
  if (settings.bale_update_offset === offset) return;
  settings.bale_update_offset = offset;
  await db('communications').where({ id: communicationId }).update({
    settings: toJson(settings),
    updated_at: db.fn.now()
  });
}

/**
 * @returns {{ status: 'stored'|'duplicate'|'skipped', id?: number }}
 */
async function processBaleUpdate(communicationRow, update) {
  if (!communicationRow || communicationRow.platform !== 'bale') {
    return { status: 'skipped' };
  }
  const parsed = parseBaleUpdate(update);
  if (!parsed) return { status: 'skipped' };

  const { persistBaleMessage } = require('./baleInbox.service');
  const stored = await persistBaleMessage(communicationRow.id, {
    external_message_id: parsed.external_message_id,
    chat_id: parsed.chat_id,
    direction: 'inbound',
    sender_id: parsed.sender_id,
    sender_username: parsed.sender_username,
    sender_first_name: parsed.sender_first_name,
    text: parsed.text,
    read_at: null
  });
  return stored.status === 'duplicate'
    ? { status: 'duplicate', id: stored.id }
    : { status: 'stored', id: stored.id };
}

async function registerBaleWebhookIfConfigured(communicationRow) {
  if (!communicationRow || communicationRow.platform !== 'bale' || !communicationRow.is_connected) {
    return { registered: false };
  }
  if (!canAutoRegisterWebhook()) return { registered: false, reason: 'no_https_public_url' };
  const secret = communicationRow.inbound_webhook_secret;
  if (!secret) return { registered: false, reason: 'no_secret' };

  const settings = parseJson(communicationRow.settings, {});
  let token;
  try {
    token = decryptCommToken(settings.token_enc);
  } catch (err) {
    safeLog('[baleInbound] webhook register skipped: token unavailable');
    return { registered: false, reason: 'token' };
  }

  const url = buildWebhookUrl(secret);
  try {
    await baleApiCall(token, 'setWebhook', { url });
    return { registered: true };
  } catch (err) {
    safeLog('[baleInbound] setWebhook failed:', err && err.message);
    return { registered: false, reason: 'api_error' };
  }
}

async function deleteBaleWebhookIfConnected(communicationRow) {
  if (!communicationRow || communicationRow.platform !== 'bale') return;
  const settings = parseJson(communicationRow.settings, {});
  if (!settings.token_enc) return;
  let token;
  try {
    token = decryptCommToken(settings.token_enc);
  } catch {
    return;
  }
  try {
    await baleApiCall(token, 'deleteWebhook', {});
  } catch (err) {
    safeLog('[baleInbound] deleteWebhook failed:', err && err.message);
  }
}

async function pollBaleInboundOnce() {
  const rows = await db('communications')
    .where({ platform: 'bale', is_connected: true })
    .select('*');
  for (const row of rows) {
    await pollSingleConnection(row);
  }
}

async function pollSingleConnection(row) {
  const settings = parseJson(row.settings, {});
  if (!settings.token_enc) return;
  let token;
  try {
    token = decryptCommToken(settings.token_enc);
  } catch (err) {
    safeLog('[baleInbound] poll skipped: token unavailable');
    return;
  }

  const offset = Number(settings.bale_update_offset || 0);
  let updates;
  try {
    updates = await baleApiCall(token, 'getUpdates', {
      offset: offset > 0 ? offset : undefined,
      timeout: 0,
      limit: 50
    });
  } catch (err) {
    safeLog('[baleInbound] getUpdates failed:', err && err.message);
    return;
  }

  if (!Array.isArray(updates) || !updates.length) return;

  let maxUpdateId = -1;
  for (const u of updates) {
    await processBaleUpdate(row, u);
    if (typeof u.update_id === 'number' && u.update_id > maxUpdateId) {
      maxUpdateId = u.update_id;
    }
  }
  if (maxUpdateId >= 0) {
    await savePollOffset(row.id, maxUpdateId + 1);
  }
}

async function handleWebhookRequest(secret, body) {
  const row = await findCommunicationByWebhookSecret(secret);
  if (!row) {
    throw new AppError('یافت نشد', 404);
  }
  if (!body || typeof body !== 'object') {
    return { ok: true, status: 'ignored' };
  }
  const result = await processBaleUpdate(row, body);
  return { ok: true, ...result };
}

module.exports = {
  generateWebhookSecret,
  parseBaleUpdate,
  processBaleUpdate,
  findCommunicationByWebhookSecret,
  registerBaleWebhookIfConfigured,
  deleteBaleWebhookIfConnected,
  pollBaleInboundOnce,
  pollSingleConnection,
  handleWebhookRequest,
  buildWebhookUrl,
  canAutoRegisterWebhook
};
