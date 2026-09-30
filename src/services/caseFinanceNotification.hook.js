const notificationService = require('./notification.service');
const { safeLog } = require('../utils/logger');

const TITLES = {
  fee_updated: 'حق‌الوکاله به‌روزرسانی شد',
  payment_recorded: 'پرداخت جدید ثبت شد',
  payment_cancelled: 'پرداخت لغو شد'
};

function formatAmount(amount, currency = 'IRR') {
  const n = String(amount ?? '0');
  return `${n} ${currency}`;
}

async function emitCaseFinanceNotification(type, payload, actorUser, trx) {
  if (!type || !payload) return;
  const caseId = Number(payload.case_id ?? payload.caseId);
  if (!Number.isInteger(caseId) || caseId <= 0) return;

  const title = TITLES[type] || 'امور مالی پرونده';
  let body = payload.body;
  if (!body) {
    if (type === 'fee_updated') {
      body = `حق‌الوکاله: ${formatAmount(payload.agreed_fee ?? payload.agreedFee, payload.currency)}`;
    } else if (type === 'payment_recorded' || type === 'payment_cancelled') {
      body = formatAmount(payload.amount, payload.currency);
      if (payload.description) body += ` — ${String(payload.description).trim()}`;
    } else {
      body = 'به‌روزرسانی مالی پرونده';
    }
  }

  const entityType = type === 'fee_updated' ? 'case_financial' : 'case_payment';
  const entityId = Number(payload.entity_id ?? payload.entityId ?? payload.id);
  if (!Number.isInteger(entityId) || entityId <= 0) return;

  try {
    await notificationService.notifyActiveCaseClients(
      caseId,
      {
        type,
        title,
        body: String(body).slice(0, 4000),
        case_id: caseId,
        entity_type: entityType,
        entity_id: entityId
      },
      trx,
      { excludeUserId: actorUser?.id }
    );
  } catch (err) {
    safeLog('[notification] case finance notify failed', {
      type,
      caseId,
      entityId,
      actorUserId: actorUser?.id,
      error: err?.message || String(err)
    });
    throw err;
  }
}

module.exports = { emitCaseFinanceNotification };
