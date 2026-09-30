const service = require('../services/notification.service');
const { ok } = require('../utils/response');

async function list(req, res) {
  const data = await service.listUserNotifications(req.user.id, req.query);
  return ok(res, data);
}

async function unreadCount(req, res) {
  const count = await service.getUnreadCount(req.user.id);
  return ok(res, { unreadCount: count });
}

async function markRead(req, res) {
  const notificationId = Number(req.params.notificationId);
  const row = await service.markAsRead(notificationId, req.user.id);
  return ok(res, row);
}

async function markAllRead(req, res) {
  const result = await service.markAllAsRead(req.user.id);
  return ok(res, result);
}

async function remove(req, res) {
  const notificationId = Number(req.params.notificationId);
  const result = await service.deleteNotification(notificationId, req.user.id);
  return ok(res, result);
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove
};
