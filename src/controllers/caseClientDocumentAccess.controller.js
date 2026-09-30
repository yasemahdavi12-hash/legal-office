const path = require('path');
const service = require('../services/caseClientDocumentAccess.service');
const { ok } = require('../utils/response');

async function share(req, res) {
  const caseId = Number(req.params.caseId);
  const documentId = Number(req.params.documentId);
  const clientId = Number(req.body.clientId ?? req.body.client_id);
  const data = await service.shareDocumentWithClient(caseId, documentId, clientId, req.user);
  return ok(res, data, 200);
}

async function listShared(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listSharedDocumentsForCase(caseId, req.user));
}

async function revoke(req, res) {
  const caseId = Number(req.params.caseId);
  const documentId = Number(req.params.documentId);
  const clientId = Number(req.params.clientId);
  return ok(res, await service.revokeDocumentShare(caseId, documentId, clientId, req.user));
}

async function listPortalDocuments(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listPortalCaseDocuments(caseId, req.user));
}

async function downloadPortalDocument(req, res) {
  const caseId = Number(req.params.caseId);
  const documentId = Number(req.params.documentId);
  const file = await service.getPortalDocumentDownload(caseId, documentId, req.user);
  res.setHeader('Content-Type', file.fileType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(path.resolve(file.absPath));
}

module.exports = {
  share,
  listShared,
  revoke,
  listPortalDocuments,
  downloadPortalDocument
};
