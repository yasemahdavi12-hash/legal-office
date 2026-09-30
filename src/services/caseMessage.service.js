const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { assertCaseAccess } = require('./case.service');
const { assertClientActiveCaseAccess } = require('./caseClientAccess.service');
const { insertReturningId } = require('../utils/dbHelpers');
const notificationService = require('./notification.service');
const { safeLog } = require('../utils/logger');

const MAX_BODY = 5000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function normalizeMessageBody(raw) {
  const body = String(raw ?? '').trim();
  if (!body) throw new AppError('متن پیام الزامی است', 400);
  if (body.length > MAX_BODY) {
    throw new AppError(`پیام حداکثر ${MAX_BODY} کاراکتر مجاز است`, 400);
  }
  return body;
}

function mapMessageOut(row) {
  if (!row) return null;
  const fromLawyer = row.sender_user_id != null;
  return {
    id: row.id,
    caseId: row.case_id,
    body: row.body,
    senderUserId: row.sender_user_id || null,
    senderClientId: row.sender_client_id || null,
    senderRole: fromLawyer ? 'lawyer' : 'client',
    readAt: row.read_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseLimit(query = {}) {
  const n = Number(query.limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

async function notifyAfterMessage(caseId, messageId, user, direction, trx) {
  try {
    if (direction === 'lawyer') {
      await notificationService.notifyActiveCaseClients(
        caseId,
        {
          type: 'new_message',
          title: 'پیام جدید',
          body: 'وکیل شما یک پیام جدید ارسال کرده است.',
          case_id: caseId,
          entity_type: 'case_message',
          entity_id: messageId
        },
        trx,
        { excludeUserId: user.id }
      );
      return;
    }
    await notificationService.notifyCaseOwner(
      caseId,
      {
        type: 'new_message',
        title: 'پیام جدید',
        body: 'موکل شما یک پیام جدید ارسال کرده است.',
        case_id: caseId,
        entity_type: 'case_message',
        entity_id: messageId
      },
      trx,
      { excludeUserId: user.id }
    );
  } catch (err) {
    safeLog('[notification] case message notify failed', {
      caseId,
      messageId,
      direction,
      actorUserId: user?.id,
      error: err?.message || String(err)
    });
    throw err;
  }
}

async function listCaseMessages(caseId, user, query = {}) {
  await assertCaseAccess(caseId, user);
  const limit = parseLimit(query);
  const rows = await db('case_messages')
    .where({ case_id: caseId })
    .orderBy('created_at', 'asc')
    .limit(limit);
  return rows.map(mapMessageOut);
}

async function createLawyerMessage(caseId, bodyRaw, user) {
  await assertCaseAccess(caseId, user);
  if (user.role !== 'lawyer' && user.role !== 'admin') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
  const body = normalizeMessageBody(bodyRaw);

  const row = await db.transaction(async (trx) => {
    const now = db.fn.now();
    const id = await insertReturningId(trx, 'case_messages', {
      case_id: caseId,
      sender_user_id: user.id,
      sender_client_id: null,
      body,
      read_at: null,
      created_at: now,
      updated_at: now
    });
    await notifyAfterMessage(caseId, id, user, 'lawyer', trx);
    return trx('case_messages').where({ id }).first();
  });
  return mapMessageOut(row);
}

async function listPortalCaseMessages(caseId, user, query = {}) {
  await assertClientActiveCaseAccess(caseId, user);
  const limit = parseLimit(query);
  const rows = await db('case_messages')
    .where({ case_id: caseId })
    .orderBy('created_at', 'asc')
    .limit(limit);
  return rows.map(mapMessageOut);
}

/** Unread = messages from the other party with read_at null (own messages never counted). */
async function countUnreadForLawyer(caseId, user) {
  await assertCaseAccess(caseId, user);
  const row = await db('case_messages')
    .where({ case_id: caseId })
    .whereNotNull('sender_client_id')
    .whereNull('read_at')
    .count({ c: '*' })
    .first();
  const c = row?.c ?? row?.count ?? 0;
  return Number(c) || 0;
}

async function countUnreadForClient(caseId, user) {
  await assertClientActiveCaseAccess(caseId, user);
  const row = await db('case_messages')
    .where({ case_id: caseId })
    .whereNotNull('sender_user_id')
    .whereNull('read_at')
    .count({ c: '*' })
    .first();
  const c = row?.c ?? row?.count ?? 0;
  return Number(c) || 0;
}

async function markReadForLawyer(caseId, user) {
  await assertCaseAccess(caseId, user);
  const now = db.fn.now();
  const updated = await db('case_messages')
    .where({ case_id: caseId })
    .whereNotNull('sender_client_id')
    .whereNull('read_at')
    .update({ read_at: now, updated_at: now });
  return { ok: true, marked: updated };
}

async function markReadForClient(caseId, user) {
  await assertClientActiveCaseAccess(caseId, user);
  const now = db.fn.now();
  const updated = await db('case_messages')
    .where({ case_id: caseId })
    .whereNotNull('sender_user_id')
    .whereNull('read_at')
    .update({ read_at: now, updated_at: now });
  return { ok: true, marked: updated };
}

async function createClientMessage(caseId, bodyRaw, user) {
  const { access } = await assertClientActiveCaseAccess(caseId, user);
  const body = normalizeMessageBody(bodyRaw);

  const row = await db.transaction(async (trx) => {
    const now = db.fn.now();
    const id = await insertReturningId(trx, 'case_messages', {
      case_id: caseId,
      sender_user_id: null,
      sender_client_id: access.client_id,
      body,
      read_at: null,
      created_at: now,
      updated_at: now
    });
    await notifyAfterMessage(caseId, id, user, 'client', trx);
    return trx('case_messages').where({ id }).first();
  });
  return mapMessageOut(row);
}

module.exports = {
  normalizeMessageBody,
  listCaseMessages,
  createLawyerMessage,
  listPortalCaseMessages,
  createClientMessage,
  countUnreadForLawyer,
  countUnreadForClient,
  markReadForLawyer,
  markReadForClient,
  mapMessageOut
};
