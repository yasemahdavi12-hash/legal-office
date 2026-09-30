const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { insertReturningId } = require('../utils/dbHelpers');

const NOTIFICATION_TYPES = Object.freeze([
  'new_message',
  'document_request',
  'document_submitted',
  'document_approved',
  'document_rejected',
  'event_created',
  'event_updated',
  'event_deleted',
  'fee_updated',
  'payment_recorded',
  'payment_cancelled',
  'invitation',
  'system'
]);

const MAX_TITLE = 255;
const MAX_BODY = 4000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function conn(trx) {
  return trx || db;
}

function normalizeType(type) {
  const t = String(type ?? '').trim();
  if (!NOTIFICATION_TYPES.includes(t)) {
    throw new AppError('نوع اعلان نامعتبر است', 400);
  }
  return t;
}

function normalizeText(raw, maxLen, fieldLabel) {
  const s = String(raw ?? '').trim();
  if (!s) throw new AppError(`${fieldLabel} الزامی است`, 400);
  if (s.length > maxLen) throw new AppError(`${fieldLabel} بیش از حد طولانی است`, 400);
  return s;
}

function mapNotificationOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    caseId: row.case_id || null,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    isRead: !!row.is_read,
    readAt: row.read_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.max(1, limit), MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

async function findDuplicateUnread(trx, { userId, type, entityType, entityId }) {
  if (!entityType || entityId == null) return null;
  return conn(trx)('notifications')
    .where({
      user_id: userId,
      type,
      entity_type: entityType,
      entity_id: entityId,
      is_read: false
    })
    .orderBy('id', 'desc')
    .first();
}

/**
 * Server-side only — userId must come from trusted context, never from client input on public API.
 */
async function createNotification(input, trx) {
  const userId = Number(input.user_id ?? input.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError('کاربر اعلان نامعتبر است', 400);
  }
  const type = normalizeType(input.type);
  const title = normalizeText(input.title, MAX_TITLE, 'عنوان');
  const body = normalizeText(input.body, MAX_BODY, 'متن');
  const caseId = input.case_id ?? input.caseId;
  const parsedCaseId = caseId == null || caseId === '' ? null : Number(caseId);
  if (parsedCaseId != null && (!Number.isInteger(parsedCaseId) || parsedCaseId <= 0)) {
    throw new AppError('پرونده نامعتبر است', 400);
  }
  const entityType = input.entity_type ?? input.entityType ?? null;
  const entityIdRaw = input.entity_id ?? input.entityId;
  const entityId = entityIdRaw == null || entityIdRaw === '' ? null : Number(entityIdRaw);
  if (entityId != null && (!Number.isInteger(entityId) || entityId <= 0)) {
    throw new AppError('شناسه موجودیت نامعتبر است', 400);
  }

  const dup = await findDuplicateUnread(trx, {
    userId,
    type,
    entityType: entityType || null,
    entityId
  });
  if (dup) return mapNotificationOut(dup);

  const now = db.fn.now();
  const id = await insertReturningId(conn(trx), 'notifications', {
    user_id: userId,
    type,
    title,
    body,
    case_id: parsedCaseId,
    entity_type: entityType || null,
    entity_id: entityId,
    is_read: false,
    read_at: null,
    created_at: now,
    updated_at: now
  });
  const row = await conn(trx)('notifications').where({ id }).first();
  return mapNotificationOut(row);
}

async function createNotifications(items, trx) {
  const out = [];
  for (const item of items || []) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await createNotification(item, trx));
  }
  return out;
}

async function listUserNotifications(userId, query = {}) {
  const uid = Number(userId);
  const { page, limit, offset } = parsePagination(query);
  const base = db('notifications').where({ user_id: uid });
  const countRow = await base.clone().count({ c: '*' }).first();
  const total = Number(countRow?.c ?? countRow?.count ?? 0) || 0;
  const rows = await base.clone().orderBy('created_at', 'desc').limit(limit).offset(offset);
  return {
    items: rows.map(mapNotificationOut),
    pagination: {
      page,
      limit,
      total,
      totalPages: total ? Math.ceil(total / limit) : 0
    }
  };
}

async function getUnreadCount(userId) {
  const uid = Number(userId);
  const row = await db('notifications')
    .where({ user_id: uid, is_read: false })
    .count({ c: '*' })
    .first();
  return Number(row?.c ?? row?.count ?? 0) || 0;
}

async function getNotificationForUser(notificationId, userId) {
  const id = Number(notificationId);
  const uid = Number(userId);
  const row = await db('notifications').where({ id, user_id: uid }).first();
  if (!row) throw new AppError('اعلان یافت نشد', 404);
  return row;
}

async function markAsRead(notificationId, userId) {
  const row = await getNotificationForUser(notificationId, userId);
  if (row.is_read) return mapNotificationOut(row);
  const now = db.fn.now();
  await db('notifications').where({ id: row.id }).update({
    is_read: true,
    read_at: now,
    updated_at: now
  });
  const updated = await db('notifications').where({ id: row.id }).first();
  return mapNotificationOut(updated);
}

async function markAllAsRead(userId) {
  const uid = Number(userId);
  const now = db.fn.now();
  const updated = await db('notifications')
    .where({ user_id: uid, is_read: false })
    .update({ is_read: true, read_at: now, updated_at: now });
  return { ok: true, marked: updated };
}

async function deleteNotification(notificationId, userId) {
  const row = await getNotificationForUser(notificationId, userId);
  await db('notifications').where({ id: row.id }).del();
  return { ok: true };
}

async function notifyUser(userId, payload, trx) {
  return createNotification({ ...payload, user_id: userId }, trx);
}

async function notifyCaseOwner(caseId, payload, trx, { excludeUserId } = {}) {
  const c = await conn(trx)('cases').where({ id: caseId }).select('owner_id').first();
  if (!c?.owner_id) return null;
  if (excludeUserId != null && Number(c.owner_id) === Number(excludeUserId)) return null;
  return notifyUser(c.owner_id, { ...payload, case_id: payload.case_id ?? caseId }, trx);
}

async function notifyClientByClientId(clientId, payload, trx) {
  const client = await conn(trx)('clients').where({ id: clientId }).select('user_id').first();
  if (!client?.user_id) return null;
  return notifyUser(client.user_id, payload, trx);
}

async function notifyActiveCaseClients(caseId, payload, trx, { excludeUserId } = {}) {
  const rows = await conn(trx)('case_client_access as a')
    .join('clients as c', 'c.id', 'a.client_id')
    .where('a.case_id', caseId)
    .where('a.status', 'active')
    .whereNotNull('c.user_id')
    .select('c.user_id');
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const out = [];
  for (const uid of ids) {
    if (excludeUserId != null && Number(uid) === Number(excludeUserId)) continue;
    // eslint-disable-next-line no-await-in-loop
    out.push(await notifyUser(uid, { ...payload, case_id: payload.case_id ?? caseId }, trx));
  }
  return out;
}

module.exports = {
  NOTIFICATION_TYPES,
  mapNotificationOut,
  createNotification,
  createNotifications,
  listUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  notifyUser,
  notifyCaseOwner,
  notifyClientByClientId,
  notifyActiveCaseClients
};
