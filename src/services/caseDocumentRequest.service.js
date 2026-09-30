const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { assertCaseAccess } = require('./case.service');
const { getClient } = require('./client.service');
const { uploadDocumentForCaseOwner } = require('./document.service');
const { insertReturningId } = require('../utils/dbHelpers');
const caseClientAccessService = require('./caseClientAccess.service');
const { assertClientActiveCaseAccess } = caseClientAccessService;
const CASE_ACCESS_STATUSES = caseClientAccessService.STATUSES;
const { emitDocumentRequestEvent } = require('./caseDocumentRequestNotification.hook');

const STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
};

const MAX_TITLE = 200;
const MAX_DESC = 2000;
const MAX_REJECTION = 2000;

function normalizeTitle(raw) {
  const title = String(raw ?? '').trim();
  if (!title) throw new AppError('عنوان الزامی است', 400);
  if (title.length > MAX_TITLE) throw new AppError(`عنوان حداکثر ${MAX_TITLE} کاراکتر`, 400);
  return title;
}

function normalizeDescription(raw) {
  if (raw == null || raw === '') return null;
  const description = String(raw).trim();
  if (!description) return null;
  if (description.length > MAX_DESC) throw new AppError(`توضیحات حداکثر ${MAX_DESC} کاراکتر`, 400);
  return description;
}

function normalizeRejectionReason(raw) {
  const reason = String(raw ?? '').trim();
  if (!reason) throw new AppError('دلیل رد الزامی است', 400);
  if (reason.length > MAX_REJECTION) throw new AppError(`دلیل رد حداکثر ${MAX_REJECTION} کاراکتر`, 400);
  return reason;
}

function mapRequestOut(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    clientId: row.client_id,
    requestedByUserId: row.requested_by_user_id,
    title: row.title,
    description: row.description || null,
    status: row.status,
    requestedAt: row.requested_at,
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewedByUserId: row.reviewed_by_user_id || null,
    rejectionReason: row.rejection_reason || null,
    documentId: row.document_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras
  };
}

async function assertClientLinkedToCase(caseId, clientId, user) {
  await getClient(clientId, user);
  const access = await db('case_client_access')
    .where({ case_id: caseId, client_id: clientId })
    .first();
  const clientRow = await db('clients').where({ id: clientId }).first();
  const onCase = clientRow && Number(clientRow.case_id) === Number(caseId);
  if (!access && !onCase) throw new AppError('موکل به این پرونده مرتبط نیست', 404);
  if (access && access.status === CASE_ACCESS_STATUSES.REVOKED) {
    throw new AppError('موکل به این پرونده مرتبط نیست', 404);
  }
  return clientRow;
}

async function getRequestForLawyer(caseId, requestId, user) {
  await assertCaseAccess(caseId, user);
  const row = await db('case_document_requests')
    .where({ id: requestId, case_id: caseId })
    .first();
  if (!row) throw new AppError('درخواست یافت نشد', 404);
  return row;
}

async function getRequestForClient(caseId, requestId, user) {
  const { access } = await assertClientActiveCaseAccess(caseId, user);
  const row = await db('case_document_requests')
    .where({ id: requestId, case_id: caseId, client_id: access.client_id })
    .first();
  if (!row) throw new AppError('درخواست یافت نشد', 404);
  return row;
}

async function attachClientNames(rows) {
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const clients = clientIds.length
    ? await db('clients').whereIn('id', clientIds).select('id', 'name')
    : [];
  const byId = new Map(clients.map((c) => [c.id, c.name]));
  return rows.map((r) => mapRequestOut(r, { clientName: byId.get(r.client_id) || null }));
}

async function createRequest(caseId, { clientId, title, description }, user) {
  const caseRow = await assertCaseAccess(caseId, user);
  const cid = Number(clientId);
  if (!Number.isInteger(cid) || cid <= 0) throw new AppError('موکل نامعتبر است', 400);
  await assertClientLinkedToCase(caseId, cid, user);

  const normalizedTitle = normalizeTitle(title);
  const out = await db.transaction(async (trx) => {
    const now = db.fn.now();
    const id = await insertReturningId(trx, 'case_document_requests', {
      case_id: caseId,
      client_id: cid,
      requested_by_user_id: user.id,
      title: normalizedTitle,
      description: normalizeDescription(description),
      status: STATUS.PENDING,
      requested_at: now,
      submitted_at: null,
      reviewed_at: null,
      reviewed_by_user_id: null,
      rejection_reason: null,
      document_id: null,
      created_at: now,
      updated_at: now
    });
    await emitDocumentRequestEvent(
      'request_created',
      { requestId: id, caseId, clientId: cid, title: normalizedTitle },
      trx
    );
    const row = await trx('case_document_requests').where({ id }).first();
    return mapRequestOut(row, {
      clientName: (await trx('clients').where({ id: cid }).select('name').first())?.name
    });
  });
  return out;
}

async function listRequestsForLawyer(caseId, user) {
  await assertCaseAccess(caseId, user);
  const rows = await db('case_document_requests')
    .where({ case_id: caseId })
    .orderBy('created_at', 'desc');
  return attachClientNames(rows);
}

async function listRequestsForClient(caseId, user) {
  const { access } = await assertClientActiveCaseAccess(caseId, user);
  const rows = await db('case_document_requests')
    .where({ case_id: caseId, client_id: access.client_id })
    .orderBy('created_at', 'desc');
  return rows.map((r) => mapRequestOut(r));
}

async function submitRequest(caseId, requestId, file, user, meta = {}) {
  const { access, caseRow } = await assertClientActiveCaseAccess(caseId, user);
  const row = await getRequestForClient(caseId, requestId, user);
  if (row.status === STATUS.CANCELLED) {
    throw new AppError('این درخواست لغو شده است', 400);
  }
  if (row.status === STATUS.APPROVED) {
    throw new AppError('این درخواست قبلاً تأیید شده است', 400);
  }
  if (row.status !== STATUS.PENDING) {
    throw new AppError('در این وضعیت امکان ارسال مدرک نیست', 400);
  }

  const doc = await uploadDocumentForCaseOwner(
    {
      case_id: caseId,
      caseId,
      file_name: row.title,
      name: row.title,
      category: 'client'
    },
    file,
    caseRow.owner_id,
    { ip: meta.ip, actorUserId: user.id }
  );

  const updated = await db.transaction(async (trx) => {
    const now = db.fn.now();
    await trx('case_document_requests').where({ id: row.id }).update({
      document_id: doc.id,
      status: STATUS.SUBMITTED,
      submitted_at: now,
      updated_at: now,
      rejection_reason: null,
      reviewed_at: null,
      reviewed_by_user_id: null
    });
    await emitDocumentRequestEvent(
      'request_submitted',
      { requestId: row.id, caseId, clientId: access.client_id, title: row.title },
      trx
    );
    return trx('case_document_requests').where({ id: row.id }).first();
  });
  return mapRequestOut(updated);
}

async function approveRequest(caseId, requestId, user) {
  const row = await getRequestForLawyer(caseId, requestId, user);
  if (row.status !== STATUS.SUBMITTED) {
    throw new AppError('فقط درخواست‌های ارسال‌شده قابل تأیید هستند', 400);
  }
  if (!row.document_id) throw new AppError('مدرک یافت نشد', 400);

  const doc = await db('documents').where({ id: row.document_id }).whereNull('deleted_at').first();
  if (!doc || Number(doc.case_id) !== Number(caseId)) {
    throw new AppError('مدرک یافت نشد', 404);
  }

  const updated = await db.transaction(async (trx) => {
    const now = db.fn.now();
    await trx('case_document_requests').where({ id: row.id }).update({
      status: STATUS.APPROVED,
      reviewed_at: now,
      reviewed_by_user_id: user.id,
      updated_at: now
    });
    await emitDocumentRequestEvent(
      'request_approved',
      { requestId: row.id, caseId, clientId: row.client_id, title: row.title },
      trx
    );
    return trx('case_document_requests').where({ id: row.id }).first();
  });
  return mapRequestOut(updated);
}

async function rejectRequest(caseId, requestId, rejectionReason, user) {
  const row = await getRequestForLawyer(caseId, requestId, user);
  if (row.status !== STATUS.SUBMITTED) {
    throw new AppError('فقط درخواست‌های ارسال‌شده قابل رد هستند', 400);
  }
  const reason = normalizeRejectionReason(rejectionReason);
  const updated = await db.transaction(async (trx) => {
    const now = db.fn.now();
    await trx('case_document_requests').where({ id: row.id }).update({
      status: STATUS.REJECTED,
      rejection_reason: reason,
      reviewed_at: now,
      reviewed_by_user_id: user.id,
      updated_at: now
    });
    await emitDocumentRequestEvent(
      'request_rejected',
      {
        requestId: row.id,
        caseId,
        clientId: row.client_id,
        title: row.title,
        rejectionReason: reason
      },
      trx
    );
    return trx('case_document_requests').where({ id: row.id }).first();
  });
  return mapRequestOut(updated);
}

async function cancelRequest(caseId, requestId, user) {
  const row = await getRequestForLawyer(caseId, requestId, user);
  if (row.status !== STATUS.PENDING) {
    throw new AppError('فقط درخواست‌های در انتظار قابل لغو هستند', 400);
  }
  const now = db.fn.now();
  await db('case_document_requests').where({ id: row.id }).update({
    status: STATUS.CANCELLED,
    updated_at: now
  });
  const updated = await db('case_document_requests').where({ id: row.id }).first();
  emitDocumentRequestEvent('request_cancelled', { requestId: row.id, caseId });
  return mapRequestOut(updated);
}

module.exports = {
  STATUS,
  createRequest,
  listRequestsForLawyer,
  listRequestsForClient,
  submitRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  mapRequestOut
};
