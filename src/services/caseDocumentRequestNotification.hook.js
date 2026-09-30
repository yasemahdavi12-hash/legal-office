const db = require('../db/connection');
const notificationService = require('./notification.service');

async function emitDocumentRequestEvent(event, payload = {}, trx) {
  const { requestId, caseId, clientId, title, rejectionReason } = payload;
  if (!requestId || !caseId) return;

  let docTitle = title;
  if (!docTitle) {
    const row = await (trx || db)('case_document_requests').where({ id: requestId }).select('title').first();
    docTitle = row?.title || 'مدرک';
  }
  const safeTitle = String(docTitle).trim() || 'مدرک';

  if (event === 'request_created' && clientId) {
    await notificationService.notifyClientByClientId(
      clientId,
      {
        type: 'document_request',
        title: 'درخواست مدرک جدید',
        body: `وکیل شما مدرک "${safeTitle}" را درخواست کرده است.`,
        case_id: caseId,
        entity_type: 'case_document_request',
        entity_id: requestId
      },
      trx
    );
    return;
  }

  if (event === 'request_submitted') {
    await notificationService.notifyCaseOwner(
      caseId,
      {
        type: 'document_submitted',
        title: 'مدرک جدید دریافت شد',
        body: `موکل شما یک مدرک برای درخواست "${safeTitle}" ارسال کرده است.`,
        case_id: caseId,
        entity_type: 'case_document_request',
        entity_id: requestId
      },
      trx
    );
    return;
  }

  if (event === 'request_approved' && clientId) {
    await notificationService.notifyClientByClientId(
      clientId,
      {
        type: 'document_approved',
        title: 'مدرک تأیید شد',
        body: `مدرک "${safeTitle}" توسط وکیل تأیید شد.`,
        case_id: caseId,
        entity_type: 'case_document_request',
        entity_id: requestId
      },
      trx
    );
    return;
  }

  if (event === 'request_rejected' && clientId) {
    const reason = String(rejectionReason ?? '').trim();
    const body = reason
      ? `مدرک ${safeTitle} رد شد: ${reason}`
      : `مدرک ${safeTitle} رد شد.`;
    await notificationService.notifyClientByClientId(
      clientId,
      {
        type: 'document_rejected',
        title: 'مدرک رد شد',
        body,
        case_id: caseId,
        entity_type: 'case_document_request',
        entity_id: requestId
      },
      trx
    );
  }
}

module.exports = { emitDocumentRequestEvent };
