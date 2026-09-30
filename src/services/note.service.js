const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { mapNoteOut } = require('../utils/mappers');
const { assertCaseAccess } = require('./case.service');
const { insertReturningId } = require('../utils/dbHelpers');

const CATEGORIES = ['general', 'hearing', 'client', 'legal', 'followup'];

function pick(body = {}) {
  return {
    title: body.title,
    content: body.content || body.body || body.text || null,
    category: body.category || body.cat || 'general',
    case_id: body.case_id ?? body.caseId ?? null
  };
}

async function listNotes(user, query = {}) {
  let q = db('notes').select('*').orderBy('created_at', 'desc');
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  if (query.case_id) q = q.where({ case_id: query.case_id });
  if (query.category) q = q.where({ category: query.category });
  const rows = await q;
  return rows.map(mapNoteOut);
}

async function getNote(id, user) {
  const row = await db('notes').where({ id }).first();
  if (!row) throw new AppError('یادداشت یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) throw new AppError('یادداشت یافت نشد', 404);
  return mapNoteOut(row);
}

async function createNote(body, user) {
  const data = pick(body);
  if (!data.title) throw new AppError('عنوان یادداشت الزامی است', 400);
  if (!CATEGORIES.includes(data.category)) throw new AppError('دسته‌بندی نامعتبر است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);

  const id = await insertReturningId(db, 'notes', {
    ...data,
    owner_id: user.id,
    created_at: db.fn.now()
  });
  return getNote(id, user);
}

async function updateNote(id, body, user) {
  await getNote(id, user);
  const data = pick(body);
  if (!data.title) throw new AppError('عنوان یادداشت الزامی است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);
  await db('notes').where({ id }).update(data);
  return getNote(id, user);
}

async function deleteNote(id, user) {
  await getNote(id, user);
  await db('notes').where({ id }).del();
  return { ok: true };
}

module.exports = { listNotes, getNote, createNote, updateNote, deleteNote };
