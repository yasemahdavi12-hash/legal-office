const path = require('path');
const service = require('../services/document.service');
const { ok } = require('../utils/response');

async function list(req, res) {
  return ok(res, await service.listDocuments(req.user, req.query));
}
async function get(req, res) {
  return ok(res, await service.getDocument(req.params.id, req.user));
}
async function create(req, res) {
  return ok(res, await service.uploadDocument(req.body, req.file, req.user, { ip: req.ip }), 201);
}
async function download(req, res) {
  const file = await service.getDownloadStream(req.params.id, req.user);
  res.setHeader('Content-Type', file.fileType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(path.resolve(file.absPath));
}
async function remove(req, res) {
  const permanent = String(req.query.permanent || req.query.force || '').toLowerCase() === 'true'
    || req.query.permanent === '1';
  return ok(res, await service.deleteDocument(req.params.id, req.user, { ip: req.ip, permanent }));
}

module.exports = { list, get, create, download, remove };
