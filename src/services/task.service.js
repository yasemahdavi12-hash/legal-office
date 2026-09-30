const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { mapTaskOut } = require('../utils/mappers');
const { assertCaseAccess } = require('./case.service');
const { insertReturningId } = require('../utils/dbHelpers');

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['high', 'med', 'low'];

function pick(body = {}) {
  return {
    title: body.title,
    status: body.status || 'todo',
    priority: body.priority || 'med',
    due_date: body.due_date || body.due || null,
    note: body.note || null,
    case_id: body.case_id ?? body.caseId ?? null
  };
}

async function listTasks(user, query = {}) {
  let q = db('tasks').select('*').orderBy('id', 'desc');
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  if (query.case_id) q = q.where({ case_id: query.case_id });
  if (query.status) q = q.where({ status: query.status });
  const rows = await q;
  return rows.map(mapTaskOut);
}

async function getTask(id, user) {
  const row = await db('tasks').where({ id }).first();
  if (!row) throw new AppError('وظیفه یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) throw new AppError('وظیفه یافت نشد', 404);
  return mapTaskOut(row);
}

async function createTask(body, user) {
  const data = pick(body);
  if (!data.title) throw new AppError('عنوان وظیفه الزامی است', 400);
  if (!STATUSES.includes(data.status)) throw new AppError('وضعیت نامعتبر است', 400);
  if (!PRIORITIES.includes(data.priority)) throw new AppError('اولویت نامعتبر است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);

  const id = await insertReturningId(db, 'tasks', {
    ...data,
    owner_id: user.id,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  return getTask(id, user);
}

async function updateTask(id, body, user) {
  await getTask(id, user);
  const data = pick(body);
  if (!data.title) throw new AppError('عنوان وظیفه الزامی است', 400);
  if (!STATUSES.includes(data.status)) throw new AppError('وضعیت نامعتبر است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);
  await db('tasks').where({ id }).update({ ...data, updated_at: db.fn.now() });
  return getTask(id, user);
}

async function deleteTask(id, user) {
  await getTask(id, user);
  await db('tasks').where({ id }).del();
  return { ok: true };
}

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask };
