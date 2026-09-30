const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { mapCaseOut, toCaseStatusDb, CASE_STATUS_DB } = require('../utils/mappers');
const { writeAudit, diffObjects } = require('./audit.service');
const { insertReturningId } = require('../utils/dbHelpers');
const { assertCanCreateCase } = require('./subscription.service');

const AUDIT_FIELDS = [
  'case_number', 'archive_number', 'branch', 'title', 'description',
  'status', 'supervision_date', 'supervision_time', 'supervision_note'
];

function pickCaseInput(body = {}) {
  return {
    case_number: body.case_number || body.num,
    archive_number: body.archive_number || body.archive || null,
    branch: body.branch || null,
    title: body.title || body.subject,
    description: body.description || body.desc || null,
    status: toCaseStatusDb(body.status),
    supervision_date: body.supervision_date || body.supervisionDate || null,
    supervision_time: body.supervision_time || body.supervisionTime || null,
    supervision_note: body.supervision_note || body.supervisionNote || null
  };
}

async function assertCaseAccess(caseId, user) {
  if (user.role === 'client') {
    throw new AppError('پرونده یافت نشد', 404);
  }
  const row = await db('cases').where({ id: caseId }).first();
  // Uniform 404 avoids IDOR resource-existence leaks
  if (!row) throw new AppError('پرونده یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) {
    throw new AppError('پرونده یافت نشد', 404);
  }
  return row;
}

async function listCases(user, query = {}) {
  if (user.role === 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
  let q = db('cases').select('*').orderBy('updated_at', 'desc');
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  if (query.status) q = q.where({ status: toCaseStatusDb(query.status) });
  if (query.q) {
    const like = `%${query.q}%`;
    q = q.andWhere(function () {
      this.where('case_number', 'like', like)
        .orWhere('archive_number', 'like', like)
        .orWhere('title', 'like', like)
        .orWhere('branch', 'like', like);
    });
  }
  const rows = await q;
  return rows.map(mapCaseOut);
}

async function getCase(id, user) {
  const row = await assertCaseAccess(id, user);
  return mapCaseOut(row);
}

async function createCase(body, user, meta = {}) {
  if (user.role === 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
  const data = pickCaseInput(body);
  if (!data.case_number || !data.title) {
    throw new AppError('شماره و عنوان پرونده الزامی است', 400);
  }
  if (!CASE_STATUS_DB.includes(data.status)) {
    throw new AppError('وضعیت پرونده نامعتبر است', 400);
  }

  // FREE quota = TOTAL cases (any status). Archive does not free quota.
  await assertCanCreateCase(user);

  const id = await insertReturningId(db, 'cases', {
    ...data,
    owner_id: user.id,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const created = await db('cases').where({ id }).first();
  await writeAudit({
    userId: user.id,
    action: 'CREATE',
    entityType: 'case',
    entityId: id,
    changes: data,
    ip: meta.ip
  });
  return mapCaseOut(created);
}

async function updateCase(id, body, user, meta = {}) {
  const before = await assertCaseAccess(id, user);
  const data = pickCaseInput({ ...before, ...body });
  if (body.status !== undefined) data.status = toCaseStatusDb(body.status);
  if (body.supervision_date !== undefined || body.supervisionDate !== undefined) {
    data.supervision_date = body.supervision_date || body.supervisionDate || null;
  }
  if (body.supervision_time !== undefined || body.supervisionTime !== undefined) {
    data.supervision_time = body.supervision_time || body.supervisionTime || null;
  }
  if (body.supervision_note !== undefined || body.supervisionNote !== undefined) {
    data.supervision_note = body.supervision_note || body.supervisionNote || null;
  }
  if (!CASE_STATUS_DB.includes(data.status)) {
    throw new AppError('وضعیت پرونده نامعتبر است', 400);
  }

  await db('cases').where({ id }).update({ ...data, updated_at: db.fn.now() });
  const after = await db('cases').where({ id }).first();
  const changes = diffObjects(before, after, AUDIT_FIELDS);
  if (Object.keys(changes).length) {
    await writeAudit({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'case',
      entityId: id,
      changes,
      ip: meta.ip
    });
  }
  return mapCaseOut(after);
}

async function deleteCase(id, user, meta = {}) {
  const before = await assertCaseAccess(id, user);
  await db('cases').where({ id }).del();
  await writeAudit({
    userId: user.id,
    action: 'DELETE',
    entityType: 'case',
    entityId: id,
    changes: { case_number: before.case_number, title: before.title },
    ip: meta.ip
  });
  return { ok: true };
}

module.exports = {
  listCases,
  getCase,
  createCase,
  updateCase,
  deleteCase,
  assertCaseAccess
};
