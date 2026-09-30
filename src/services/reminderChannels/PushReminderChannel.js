const webpush = require('web-push');
const db = require('../../db/connection');
const config = require('../../config');
const { ReminderChannelInterface } = require('./ReminderChannelInterface');
const { safeLog } = require('../../utils/logger');

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;
  const pub = (process.env.VAPID_PUBLIC_KEY || (config.vapid && config.vapid.publicKey) || '').trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || (config.vapid && config.vapid.privateKey) || '').trim();
  const subject = (process.env.VAPID_SUBJECT || (config.vapid && config.vapid.subject) || 'mailto:admin@legal.local').trim();
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

class PushReminderChannel extends ReminderChannelInterface {
  get name() {
    return 'push';
  }

  isEnabled() {
    return ensureVapid();
  }

  async canDeliver(userId) {
    if (!this.isEnabled()) return false;
    const row = await db('push_subscriptions').where({ user_id: userId }).first();
    return !!row;
  }

  async deliver({ userId, title, body, data }) {
    if (!ensureVapid()) {
      return { ok: false, skipped: true, error: 'vapid_not_configured' };
    }
    const subs = await db('push_subscriptions').where({ user_id: userId });
    if (!subs.length) {
      return { ok: false, skipped: true, error: 'no_subscription' };
    }

    let anyOk = false;
    let lastError = null;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          JSON.stringify({
            title: title || 'یادآوری',
            body: body || '',
            data: data || {}
          }),
          { TTL: 60 * 60 }
        );
        anyOk = true;
      } catch (err) {
        lastError = err && err.message ? err.message : 'push_failed';
        const status = err && err.statusCode;
        // Gone / expired subscription
        if (status === 404 || status === 410) {
          await db('push_subscriptions').where({ id: sub.id }).del();
        } else {
          safeLog('[push] deliver failed', status || lastError);
        }
      }
    }
    if (anyOk) return { ok: true };
    return { ok: false, skipped: !lastError, error: lastError || 'push_failed' };
  }
}

module.exports = { PushReminderChannel, ensureVapid };
