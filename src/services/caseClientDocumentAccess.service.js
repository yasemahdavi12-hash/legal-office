const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { assertCaseAccess } = require('./case.service');
const { getClient } = require('./client.service');
const { getDocumentRow, getDownloadStreamForRow } = require('./document.service');
const { mapDocumentOut } = require('../utils/mappers');
const { insertReturningId } = require('../utils/dbHelpers');
const caseClientAccessService = require('./caseClientAccess.service');
const { assertClientActiveCaseAccess } = caseClientAccessService;
const CASE_ACCESS_STATUSES = caseClientAccessService.STATUSES;

const DOC_SHARE_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked'
};

function mapShareOut(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    documentId: row.document_id,
    clientId: row.client_id,
    status: row.status,
    sharedByUserId: row.shared_by_user_id,
    sharedAt: row.shared_at,
    revokedAt: row.revoked_at || null,
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
  if (!access && !onCase) {
    throw new AppError('موکل به این پرونده مرتبط نیست', 404);
  }
  if (access && access.status === CASE_ACCESS_STATUSES.REVOKED) {
    throw new AppError('موکل به این پرونده مرتبط نیست', 404);
  }
  return clientRow;
}

async function assertDocumentOnCase(documentId, caseId, user) {
  const doc = await getDocumentRow(documentId, user);
  if (Number(doc.case_id) !== Number(caseId)) {
    throw new AppError('سند یافت نشد', 404);
  }
  return doc;
}

async function shareDocumentWithClient(caseId, documentId, clientId, user) {
  await assertCaseAccess(caseId, user);
  await assertDocumentOnCase(documentId, caseId, user);
  await assertClientLinkedToCase(caseId, clientId, user);

  const existing = await db('case_client_document_access')
    .where({ document_id: documentId, client_id: clientId })
    .first();

  if (existing && existing.status === DOC_SHARE_STATUS.ACTIVE) {
    return mapShareOut(existing);
  }

  const now = db.fn.now();
  if (existing && existing.status === DOC_SHARE_STATUS.REVOKED) {
    await db('case_client_document_access').where({ id: existing.id }).update({
      case_id: caseId,
      status: DOC_SHARE_STATUS.ACTIVE,
      shared_by_user_id: user.id,
      shared_at: now,
      revoked_at: null,
      updated_at: now
    });
    const updated = await db('case_client_document_access').where({ id: existing.id }).first();
    return mapShareOut(updated);
  }

  const id = await insertReturningId(db, 'case_client_document_access', {
    case_id: caseId,
    document_id: documentId,
    client_id: clientId,
    shared_by_user_id: user.id,
    status: DOC_SHARE_STATUS.ACTIVE,
    shared_at: now,
    revoked_at: null,
    created_at: now,
    updated_at: now
  });
  const row = await db('case_client_document_access').where({ id }).first();
  return mapShareOut(row);
}

async function listSharedDocumentsForCase(caseId, user) {
  await assertCaseAccess(caseId, user);
  const rows = await db('case_client_document_access as a')
    .join('clients as c', 'c.id', 'a.client_id')
    .join('documents as d', 'd.id', 'a.document_id')
    .where('a.case_id', caseId)
    .where('a.status', DOC_SHARE_STATUS.ACTIVE)
    .whereNull('d.deleted_at')
    .select(
      'a.*',
      'c.name as client_name',
      'd.file_name',
      'd.file_type',
      'd.uploaded_at'
    )
    .orderBy('a.shared_at', 'desc');

  return rows.map((r) => mapShareOut(r, {
    clientName: r.client_name,
    documentName: r.file_name,
    fileType: r.file_type,
    uploadedAt: r.uploaded_at
  }));
}

async function revokeDocumentShare(caseId, documentId, clientId, user) {
  await assertCaseAccess(caseId, user);
  await assertDocumentOnCase(documentId, caseId, user);
  await assertClientLinkedToCase(caseId, clientId, user);

  const row = await db('case_client_document_access')
    .where({
      case_id: caseId,
      document_id: documentId,
      client_id: clientId,
      status: DOC_SHARE_STATUS.ACTIVE
    })
    .first();

  if (!row) throw new AppError('اشتراک یافت نشد', 404);

  const now = db.fn.now();
  await db('case_client_document_access').where({ id: row.id }).update({
    status: DOC_SHARE_STATUS.REVOKED,
    revoked_at: now,
    updated_at: now
  });
  const updated = await db('case_client_document_access').where({ id: row.id }).first();
  return mapShareOut(updated);
}

async function listPortalCaseDocuments(caseId, user) {
  const { access } = await assertClientActiveCaseAccess(caseId, user);
  const clientId = access.client_id;

  const rows = await db('case_client_document_access as a')
    .join('documents as d', 'd.id', 'a.document_id')
    .where('a.case_id', caseId)
    .where('a.client_id', clientId)
    .where('a.status', DOC_SHARE_STATUS.ACTIVE)
    .whereNull('d.deleted_at')
    .where('d.case_id', caseId)
    .select('d.*', 'a.shared_at')
    .orderBy('a.shared_at', 'desc');

  return rows.map((r) => ({
    ...mapDocumentOut(r),
    sharedAt: r.shared_at
  }));
}

async function getPortalDocumentDownload(caseId, documentId, user) {
  const { access } = await assertClientActiveCaseAccess(caseId, user);
  const clientId = access.client_id;

  const share = await db('case_client_document_access')
    .where({
      case_id: caseId,
      document_id: documentId,
      client_id: clientId,
      status: DOC_SHARE_STATUS.ACTIVE
    })
    .first();
  if (!share) throw new AppError('سند یافت نشد', 404);

  const row = await db('documents')
    .where({ id: documentId })
    .whereNull('deleted_at')
    .first();
  if (!row || Number(row.case_id) !== Number(caseId)) {
    throw new AppError('سند یافت نشد', 404);
  }

  return getDownloadStreamForRow(row);
}

module.exports = {
  DOC_SHARE_STATUS,
  shareDocumentWithClient,
  listSharedDocumentsForCase,
  revokeDocumentShare,
  listPortalCaseDocuments,
  getPortalDocumentDownload
};
