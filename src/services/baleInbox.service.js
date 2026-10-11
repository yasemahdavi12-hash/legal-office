const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { insertReturningId } = require('../utils/dbHelpers');
const { parseJson } = require('../utils/dbHelpers');
const { decryptCommToken } = require('./communication.service');
const { BaleService, normalizeChatId } = require('./messengers/BaleService');

const baleAdapter = new BaleService();
const MAX_TEXT = 4096;
const MAX_CHAT_ID_LEN = 128;

function extractCount(row, fallbackKey = 'total') {
  if (!row) return 0;
  if (row[fallbackKey] != null) return Number(row[fallbackKey]);
  const key = Object.keys(row).find((k) => /count/i.test(k));
  return key ? Number(row[key]) : 0;
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    communication_id: row.communication_id,
    platform: row.platform,
    chat_id: row.chat_id,
    direction: row.direction || 'inbound',
    external_message_id: row.external_message_id,
    sender_id: row.sender_id,
    sender_username: row.sender_username,
    sender_first_name: row.sender_first_name,
    text: row.text,
    created_at: row.created_at,
    read_at: row.read_at
  };
}

function validateChatId(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_CHAT_ID_LEN) {
    throw new AppError('شناسه گفتگو (chat_id) نامعتبر است', 400);
  }
  if (!/^-?\d+$/.test(s) && !/^@[A-Za-z0-9_]{4,120}$/.test(s)) {
    throw new AppError('شناسه گفتگو (chat_id) نامعتبر است', 400);
  }
  return s;
}

function validateReplyText(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new AppError('متن پیام الزامی است', 400);
  if (t.length > MAX_TEXT) throw new AppError('متن پیام بیش از ۴۰۹۶ کاراکتر است', 400);
  return t;
}

async function getOwnerBaleCommunication(user) {
  const row = await db('communications').where({ owner_id: user.id, platform: 'bale' }).first();
  if (!row) throw new AppError('اتصال بله یافت نشد', 404);
  return row;
}

async function getMessageForOwner(user, messageId) {
  const id = Number(messageId);
  if (!Number.isFinite(id) || id < 1) throw new AppError('شناسه پیام نامعتبر است', 400);
  const row = await db('communication_inbound_messages as m')
    .join('communications as c', 'c.id', 'm.communication_id')
    .where('m.id', id)
    .where('c.owner_id', user.id)
    .select('m.*')
    .first();
  if (!row) throw new AppError('پیام یافت نشد', 404);
  return row;
}

/**
 * @returns {{ status: 'stored'|'duplicate', id?: number }}
 */
async function persistBaleMessage(communicationId, fields) {
  const externalId = String(fields.external_message_id);
  const existing = await db('communication_inbound_messages')
    .where({ communication_id: communicationId, external_message_id: externalId })
    .first();
  if (existing) return { status: 'duplicate', id: existing.id };

  const id = await insertReturningId(db, 'communication_inbound_messages', {
    communication_id: communicationId,
    platform: 'bale',
    external_message_id: externalId,
    chat_id: String(fields.chat_id),
    direction: fields.direction === 'outbound' ? 'outbound' : 'inbound',
    sender_id: fields.sender_id ?? null,
    sender_username: fields.sender_username ?? null,
    sender_first_name: fields.sender_first_name ?? null,
    text: fields.text ?? null,
    read_at: fields.read_at ?? null,
    created_at: db.fn.now()
  });
  return { status: 'stored', id };
}

function threadDisplayName(row) {
  if (row.sender_first_name) return String(row.sender_first_name);
  if (row.sender_username) return `@${row.sender_username}`;
  return 'مخاطب';
}

async function listThreads(user) {
  const comm = await getOwnerBaleCommunication(user);

  const unreadRows = await db('communication_inbound_messages')
    .where({
      communication_id: comm.id,
      direction: 'inbound'
    })
    .whereNull('read_at')
    .groupBy('chat_id')
    .select('chat_id')
    .count({ unread_count: '*' });

  const unreadMap = new Map(
    unreadRows.map((r) => [String(r.chat_id), extractCount(r, 'unread_count')])
  );

  const recent = await db('communication_inbound_messages')
    .where({ communication_id: comm.id })
    .orderBy('created_at', 'desc')
    .select('*');

  const threads = new Map();
  for (const row of recent) {
    const chatId = String(row.chat_id);
    if (threads.has(chatId)) continue;
    const preview = row.text ? String(row.text).slice(0, 120) : '';
    const inbounds = recent.filter(
      (x) => String(x.chat_id) === chatId && (x.direction === 'inbound' || !x.direction)
    );
    const titleSource = inbounds.find((x) => x.sender_first_name || x.sender_username) || inbounds[0] || row;
    threads.set(chatId, {
      chat_id: chatId,
      display_name: threadDisplayName(titleSource),
      last_message_text: preview,
      last_message_at: row.created_at,
      last_direction: row.direction || 'inbound',
      unread_count: unreadMap.get(chatId) || 0,
      message_count: 0
    });
  }

  const counts = await db('communication_inbound_messages')
    .where({ communication_id: comm.id })
    .groupBy('chat_id')
    .select('chat_id')
    .count({ message_count: '*' });
  for (const c of counts) {
    const chatId = String(c.chat_id);
    if (threads.has(chatId)) {
      threads.get(chatId).message_count = extractCount(c, 'message_count');
    }
  }

  const list = [...threads.values()].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
  return { threads: list, communication_id: comm.id, is_connected: !!comm.is_connected };
}

async function listMessages(user, query = {}) {
  const comm = await getOwnerBaleCommunication(user);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const offset = (page - 1) * limit;

  let q = db('communication_inbound_messages')
    .where({ communication_id: comm.id });

  if (query.chat_id != null && String(query.chat_id).trim() !== '') {
    const chatId = validateChatId(query.chat_id);
    q = q.andWhere({ chat_id: chatId });
  }

  const countRow = await q.clone().count('* as total').first();
  const total = extractCount(countRow, 'total');

  const rows = await q
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    items: rows.map(mapMessageRow),
    page,
    limit,
    total,
    is_connected: !!comm.is_connected
  };
}

async function markMessageRead(user, messageId) {
  const row = await getMessageForOwner(user, messageId);
  if (row.direction !== 'inbound') {
    return { id: row.id, read_at: row.read_at, already: true };
  }
  if (row.read_at) {
    return { id: row.id, read_at: row.read_at, already: true };
  }
  await db('communication_inbound_messages')
    .where({ id: row.id })
    .update({ read_at: db.fn.now() });
  const updated = await db('communication_inbound_messages').where({ id: row.id }).first();
  return { id: updated.id, read_at: updated.read_at, already: false };
}

async function replyToChat(user, body = {}) {
  const comm = await getOwnerBaleCommunication(user);
  if (!comm.is_connected) {
    throw new AppError('اتصال بله برقرار نیست. ابتدا Bot را متصل کنید.', 400);
  }

  const chatIdRaw = validateChatId(body.chat_id);
  const text = validateReplyText(body.text);
  const settings = parseJson(comm.settings, {});
  const token = decryptCommToken(settings.token_enc);
  const chatId = normalizeChatId(chatIdRaw);

  let sendResult;
  try {
    sendResult = await baleAdapter.sendMessage({ token, chatId, text });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ارسال پیام بله ناموفق بود', 502);
  }

  const apiMsg = sendResult?.message || sendResult;
  const externalId = apiMsg?.message_id != null
    ? String(apiMsg.message_id)
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const stored = await persistBaleMessage(comm.id, {
    external_message_id: externalId,
    chat_id: String(chatIdRaw),
    direction: 'outbound',
    text,
    read_at: new Date()
  });

  const row = stored.id
    ? await db('communication_inbound_messages').where({ id: stored.id }).first()
    : null;

  return {
    sent: true,
    duplicate: stored.status === 'duplicate',
    message: mapMessageRow(row)
  };
}

module.exports = {
  mapMessageRow,
  validateChatId,
  validateReplyText,
  getOwnerBaleCommunication,
  getMessageForOwner,
  persistBaleMessage,
  listThreads,
  listMessages,
  markMessageRead,
  replyToChat
};
