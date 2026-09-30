const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { mapDocumentOut } = require('../utils/mappers');
const { assertCaseAccess } = require('./case.service');
const { writeAudit } = require('./audit.service');
const { insertReturningId, toDbDateTime } = require('../utils/dbHelpers');

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const DANGEROUS_NAME = /\.(php|phtml|phar|cgi|exe|sh|bat|cmd|js|mjs|cjs|html|htm|shtml|asp|aspx|jsp)(\.|$)/i;

function ensureUploadDir() {
  if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o750 });
  }
  const keep = path.join(config.uploadDir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}

function safeStoredName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`;
}

function sanitizeDisplayName(name) {
  const base = path.basename(String(name || 'document')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.replace(/[<>:"/\\|?*]/g, '_').slice(0, 180) || 'document';
}

function assertSafeUpload(file) {
  if (!file) throw new AppError('فایل الزامی است', 400);
  const original = String(file.originalname || '');
  if (DANGEROUS_NAME.test(original) || original.includes('\0') || original.includes('..')) {
    throw new AppError('نام یا نوع فایل مجاز نیست', 400);
  }
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new AppError('نوع فایل مجاز نیست', 400);
  if (!file.mimetype || !ALLOWED_MIME.has(file.mimetype)) {
    throw new AppError('نوع فایل مجاز نیست', 400);
  }
  const mimeOk =
    (ext === '.pdf' && file.mimetype === 'application/pdf') ||
    ((ext === '.doc') && file.mimetype === 'application/msword') ||
    (ext === '.docx' && file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    ((ext === '.jpg' || ext === '.jpeg') && file.mimetype === 'image/jpeg') ||
    (ext === '.png' && file.mimetype === 'image/png') ||
    (ext === '.webp' && file.mimetype === 'image/webp');
  if (!mimeOk) throw new AppError('نوع فایل مجاز نیست', 400);
}

function notDeleted(q) {
  return q.whereNull('deleted_at');
}

async function listDocuments(user, query = {}) {
  let q = db('documents').select('*').orderBy('uploaded_at', 'desc');
  q = notDeleted(q);
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  if (query.case_id) q = q.where({ case_id: query.case_id });
  if (query.category) q = q.where({ category: query.category });
  const rows = await q;
  return rows.map(mapDocumentOut);
}

async function getDocumentRow(id, user, { includeDeleted = false } = {}) {
  let q = db('documents').where({ id });
  if (!includeDeleted) q = notDeleted(q);
  const row = await q.first();
  if (!row) throw new AppError('سند یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) throw new AppError('سند یافت نشد', 404);
  return row;
}

async function getDocument(id, user) {
  return mapDocumentOut(await getDocumentRow(id, user));
}

async function uploadDocument(body, file, user, meta = {}) {
  assertSafeUpload(file);
  ensureUploadDir();

  const caseId = body.case_id || body.caseId || null;
  if (caseId) await assertCaseAccess(Number(caseId), user);

  const storedName = safeStoredName(file.originalname);
  const absPath = path.resolve(config.uploadDir, storedName);
  const rel = path.relative(path.resolve(config.uploadDir), absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError('مسیر فایل نامعتبر است', 400);
  }
  fs.renameSync(file.path, absPath);
  try { fs.chmodSync(absPath, 0o640); } catch { /* windows may ignore */ }

  const fileName = sanitizeDisplayName(body.file_name || body.name || file.originalname || 'سند');
  const id = await insertReturningId(db, 'documents', {
    case_id: caseId ? Number(caseId) : null,
    owner_id: user.id,
    file_name: fileName,
    stored_name: storedName,
    file_path: storedName,
    file_type: file.mimetype,
    category: body.category || body.cat || 'other',
    file_size: file.size || null,
    uploaded_at: db.fn.now()
  });

  await writeAudit({
    userId: user.id,
    action: 'CREATE',
    entityType: 'document',
    entityId: id,
    changes: { file_name: fileName, case_id: caseId, category: body.category || body.cat || 'other' },
    ip: meta.ip
  });

  return getDocument(id, user);
}

/** Upload into a case owned by ownerId (e.g. client portal document request). */
async function uploadDocumentForCaseOwner(body, file, ownerId, meta = {}) {
  assertSafeUpload(file);
  ensureUploadDir();
  const caseId = body.case_id || body.caseId || null;
  if (!caseId) throw new AppError('پرونده الزامی است', 400);

  const storedName = safeStoredName(file.originalname);
  const absPath = path.resolve(config.uploadDir, storedName);
  const rel = path.relative(path.resolve(config.uploadDir), absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError('مسیر فایل نامعتبر است', 400);
  }
  fs.renameSync(file.path, absPath);
  try { fs.chmodSync(absPath, 0o640); } catch { /* windows */ }

  const fileName = sanitizeDisplayName(body.file_name || body.name || file.originalname || 'سند');
  const id = await insertReturningId(db, 'documents', {
    case_id: Number(caseId),
    owner_id: ownerId,
    file_name: fileName,
    stored_name: storedName,
    file_path: storedName,
    file_type: file.mimetype,
    category: body.category || body.cat || 'client',
    file_size: file.size || null,
    uploaded_at: db.fn.now()
  });

  await writeAudit({
    userId: meta.actorUserId || ownerId,
    action: 'CREATE',
    entityType: 'document',
    entityId: id,
    changes: { file_name: fileName, case_id: caseId, category: body.category || 'client', source: 'document_request' },
    ip: meta.ip
  });

  const row = await db('documents').where({ id }).first();
  return mapDocumentOut(row);
}

async function getDownloadStreamForRow(row) {
  const absPath = resolveSafeAbs(row);
  if (!absPath) throw new AppError('سند یافت نشد', 404);
  if (!fs.existsSync(absPath)) throw new AppError('فایل روی سرور یافت نشد', 404);
  return {
    absPath,
    fileName: sanitizeDisplayName(row.file_name),
    fileType: row.file_type || 'application/octet-stream'
  };
}

async function getDownloadStream(id, user) {
  const row = await getDocumentRow(id, user);
  return getDownloadStreamForRow(row);
}

function resolveSafeAbs(row) {
  const absPath = path.resolve(config.uploadDir, path.basename(row.stored_name || row.file_path));
  const rel = path.relative(path.resolve(config.uploadDir), absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return absPath;
}

/** Soft delete (default) — hides document; file kept until permanent delete. */
async function deleteDocument(id, user, meta = {}) {
  const permanent = !!(meta.permanent || meta.force);
  const row = await getDocumentRow(id, user, { includeDeleted: permanent });

  if (permanent) {
    return permanentDeleteDocument(id, user, meta);
  }

  if (row.deleted_at) return { ok: true, soft: true };

  await db('documents').where({ id }).update({
    deleted_at: toDbDateTime(),
    deleted_by: user.id
  });
  await writeAudit({
    userId: user.id,
    action: 'SOFT_DELETE',
    entityType: 'document',
    entityId: id,
    changes: { file_name: row.file_name },
    ip: meta.ip
  });
  return { ok: true, soft: true };
}

/** Permanent delete — removes DB row + file from disk. */
async function permanentDeleteDocument(id, user, meta = {}) {
  const row = await getDocumentRow(id, user, { includeDeleted: true });
  const absPath = resolveSafeAbs(row);
  await db('documents').where({ id }).del();
  if (absPath && fs.existsSync(absPath)) {
    try { fs.unlinkSync(absPath); } catch { /* ignore */ }
  }
  await writeAudit({
    userId: user.id,
    action: 'DELETE',
    entityType: 'document',
    entityId: id,
    changes: { file_name: row.file_name, permanent: true },
    ip: meta.ip
  });
  return { ok: true, permanent: true };
}

module.exports = {
  listDocuments,
  getDocument,
  getDocumentRow,
  uploadDocument,
  uploadDocumentForCaseOwner,
  getDownloadStream,
  getDownloadStreamForRow,
  deleteDocument,
  permanentDeleteDocument,
  ensureUploadDir,
  ALLOWED_EXT,
  ALLOWED_MIME
};
