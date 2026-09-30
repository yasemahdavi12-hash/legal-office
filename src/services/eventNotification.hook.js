const notificationService = require('./notification.service');
const { safeLog } = require('../utils/logger');

const TITLES = {
  event_created: 'رویداد جدید',
  event_updated: 'رویداد ویرایش شد',
  event_deleted: 'رویداد حذف شد'
};

function formatEventWhen(event) {
  const title = String(event?.title || 'رویداد').trim() || 'رویداد';
  const date = String(event?.date || '').trim();
  const time = String(event?.time || '').trim();
  if (date && time) return `${title} · ${date} — ${time}`;
  if (date) return `${title} · ${date}`;
  return title;
}

/**
 * Notify active portal clients for a case-linked event (server-side recipients only).
 */
async function emitEventNotification(type, event, actorUser, trx) {
  if (!event || !type) return;
  const caseId = event.case_id != null ? Number(event.case_id) : null;
  if (!Number.isInteger(caseId) || caseId <= 0) return;

  const title = TITLES[type] || 'رویداد';
  const body = formatEventWhen(event);
  const eventId = Number(event.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return;

  try {
    await notificationService.notifyActiveCaseClients(
      caseId,
      {
        type,
        title,
        body,
        case_id: caseId,
        entity_type: 'event',
        entity_id: eventId
      },
      trx,
      { excludeUserId: actorUser?.id }
    );
  } catch (err) {
    safeLog('[notification] event notify failed', {
      type,
      caseId,
      eventId,
      actorUserId: actorUser?.id,
      error: err?.message || String(err)
    });
    throw err;
  }
}

module.exports = { emitEventNotification, formatEventWhen };
