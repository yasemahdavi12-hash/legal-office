const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { mapClientOut } = require('../utils/mappers');
const { assertCaseAccess } = require('./case.service');
const { insertReturningId } = require('../utils/dbHelpers');

function pick(body = {}) {
  return {
    name: body.name || [body.fname, body.lname].filter(Boolean).join(' ').trim(),
    phone: body.phone || null,
    national_id: body.national_id || body.national || null,
    description: body.description || body.notes || body.desc || null,
    case_id: body.case_id ?? body.caseId ?? null
  };
}

async function listClients(user, query = {}) {
  let q = db('clients').select('*').orderBy('id', 'desc');
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  if (query.case_id) q = q.where({ case_id: query.case_id });
  const rows = await q;
  return rows.map(mapClientOut);
}

async function getClient(id, user) {
  const row = await db('clients').where({ id }).first();
  if (!row) throw new AppError('موکل یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) throw new AppError('موکل یافت نشد', 404);
  return mapClientOut(row);
}

async function createClient(body, user) {
  const data = pick(body);
  if (!data.name) throw new AppError('نام موکل الزامی است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);

  const id = await insertReturningId(db, 'clients', {
    ...data,
    owner_id: user.id,
    created_at: db.fn.now()
  });
  return getClient(id, user);
}

async function updateClient(id, body, user) {
  await getClient(id, user);
  const data = pick(body);
  if (!data.name) throw new AppError('نام موکل الزامی است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);
  await db('clients').where({ id }).update(data);
  return getClient(id, user);
}

async function deleteClient(id, user) {
  await getClient(id, user);
  await db('clients').where({ id }).del();
  return { ok: true };
}

module.exports = { listClients, getClient, createClient, updateClient, deleteClient };
