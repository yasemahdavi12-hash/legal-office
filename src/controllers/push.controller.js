const pushService = require('../services/push.service');
const reminderService = require('../services/reminder.service');
const { ok } = require('../utils/response');

async function vapidPublicKey(req, res) {
  return ok(res, pushService.getVapidPublicKey());
}

async function subscribe(req, res) {
  const data = await pushService.subscribe(req.user, req.body || {}, {
    userAgent: req.get('user-agent')
  });
  return ok(res, data, 201);
}

async function unsubscribe(req, res) {
  return ok(res, await pushService.unsubscribe(req.user, req.body || {}));
}

async function listSubscriptions(req, res) {
  return ok(res, await pushService.listMine(req.user));
}

async function listReminders(req, res) {
  const scope = req.query.scope || 'upcoming';
  const timezone = req.query.timezone;
  return ok(res, await reminderService.listReminderFeed(req.user, { scope, timezone }));
}

module.exports = {
  vapidPublicKey,
  subscribe,
  unsubscribe,
  listSubscriptions,
  listReminders
};
