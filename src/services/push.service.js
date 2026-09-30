const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { insertReturningId } = require('../utils/dbHelpers');
const config = require('../config');
const { ensureVapid } = require('./reminderChannels/PushReminderChannel');

function getVapidPublicKey() {
  if (!ensureVapid()) {
    throw new AppError('اعلان Push پیکربندی نشده است', 503, { code: 'VAPID_NOT_CONFIGURED' });
  }
  const publicKey = (process.env.VAPID_PUBLIC_KEY || config.vapid.publicKey || '').trim();
  return { publicKey };
}

async function subscribe(user, body = {}, meta = {}) {
  if (!ensureVapid()) {
    throw new AppError('اعلان Push پیکربندی نشده است', 503, { code: 'VAPID_NOT_CONFIGURED' });
  }
  const endpoint = String(body.endpoint || '').trim();
  const keys = body.keys || {};
  const p256dh = String(keys.p256dh || body.p256dh || '').trim();
  const auth = String(keys.auth || body.auth || '').trim();
  if (!endpoint || !/^https?:\/\//i.test(endpoint) || endpoint.length > 768) {
    throw new AppError('endpoint نامعتبر است', 400);
  }
  if (!p256dh || !auth) {
    throw new AppError('کلیدهای Push نامعتبر است', 400);
  }

  const existing = await db('push_subscriptions').where({ endpoint }).first();
  if (existing) {
    // IDOR: cannot take over another user's endpoint
    if (existing.user_id !== user.id) {
      throw new AppError('اشتراک Push متعلق به کاربر دیگری است', 403);
    }
    await db('push_subscriptions').where({ id: existing.id }).update({
      p256dh,
      auth,
      user_agent: meta.userAgent || existing.user_agent,
      updated_at: db.fn.now()
    });
    return { ok: true, id: existing.id };
  }

  const id = await insertReturningId(db, 'push_subscriptions', {
    user_id: user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: meta.userAgent || null,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  return { ok: true, id };
}

async function unsubscribe(user, body = {}) {
  const endpoint = String(body.endpoint || '').trim();
  if (!endpoint) throw new AppError('endpoint الزامی است', 400);
  const row = await db('push_subscriptions').where({ endpoint }).first();
  if (!row) return { ok: true };
  if (row.user_id !== user.id) {
    throw new AppError('اشتراک Push یافت نشد', 404);
  }
  await db('push_subscriptions').where({ id: row.id, user_id: user.id }).del();
  return { ok: true };
}

async function listMine(user) {
  const rows = await db('push_subscriptions')
    .where({ user_id: user.id })
    .select('id', 'endpoint', 'created_at', 'updated_at');
  return rows.map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
}

module.exports = { getVapidPublicKey, subscribe, unsubscribe, listMine };
