const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { mapEventOut } = require('../utils/mappers');
const { assertCaseAccess } = require('./case.service');
const { insertReturningId } = require('../utils/dbHelpers');
const { DEFAULT_TIMEZONE } = require('../utils/timezone');
const {
  normalizeOffsets,
  rebuildRemindersForEvent,
  cancelRemindersForEvent
} = require('./reminder.service');
const { emitEventNotification } = require('./eventNotification.hook');

/** Canonical + legacy aliases (API backward compatible). */
const TYPE_ALIASES = {
  meeting: 'client_meeting',
  court: 'court_hearing',
  supervision: 'deadline',
  reminder: 'personal',
  court_hearing: 'court_hearing',
  client_meeting: 'client_meeting',
  client_call: 'client_call',
  deadline: 'deadline',
  document_deadline: 'document_deadline',
  payment_due: 'payment_due',
  internal_meeting: 'internal_meeting',
  personal: 'personal'
};

const STATUSES = ['scheduled', 'cancelled', 'done'];

function normalizeType(type) {
  const t = String(type || 'meeting');
  if (!TYPE_ALIASES[t]) return null;
  return TYPE_ALIASES[t];
}

async function assertClientAccess(clientId, user) {
  if (!clientId) return;
  const row = await db('clients').where({ id: clientId }).first();
  if (!row) throw new AppError('موکل یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) {
    throw new AppError('موکل یافت نشد', 404);
  }
}

function buildPayload(body = {}, existing = null) {
  const rawType = body.type != null || body.event_type != null
    ? (body.type || body.event_type)
    : (existing ? existing.type : 'meeting');
  const type = normalizeType(rawType);
  if (!type) throw new AppError('نوع رویداد نامعتبر است', 400);

  const hasReminderInput = body.reminder !== undefined || body.remind !== undefined
    || body.reminders !== undefined || body.reminder_offsets !== undefined;

  let offsets = [];
  if (hasReminderInput) {
    offsets = normalizeOffsets(body);
  } else if (existing && existing.reminder > 0) {
    offsets = [Number(existing.reminder)];
  }

  const description = body.description !== undefined
    ? body.description
    : (body.note !== undefined
      ? body.note
      : (existing ? (existing.description != null ? existing.description : existing.note) : null));

  const note = body.note !== undefined
    ? body.note
    : (description != null ? description : (existing ? existing.note : null));

  const status = body.status !== undefined
    ? body.status
    : (existing ? existing.status : 'scheduled');
  if (!STATUSES.includes(status)) throw new AppError('وضعیت رویداد نامعتبر است', 400);

  return {
    title: body.title !== undefined ? body.title : (existing && existing.title),
    type,
    date: body.date !== undefined ? body.date : (existing && existing.date),
    time: body.time !== undefined ? body.time : (existing ? existing.time : null),
    reminder: offsets.length ? offsets[0] : null,
    note,
    description,
    location: body.location !== undefined ? body.location : (existing ? existing.location : null),
    status,
    timezone: body.timezone !== undefined ? body.timezone : (existing ? existing.timezone : DEFAULT_TIMEZONE),
    case_id: body.case_id !== undefined || body.caseId !== undefined
      ? (body.case_id ?? body.caseId ?? null)
      : (existing ? existing.case_id : null),
    client_id: body.client_id !== undefined || body.clientId !== undefined
      ? (body.client_id ?? body.clientId ?? null)
      : (existing ? existing.client_id : null),
    _offsets: offsets
  };
}

async function listEvents(user, query = {}) {
  let q = db('events').select('*').orderBy('date', 'asc').orderBy('time', 'asc');
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  if (query.case_id) q = q.where({ case_id: query.case_id });
  if (query.status) q = q.where({ status: query.status });
  if (query.type) {
    const t = normalizeType(query.type);
    if (t) q = q.where({ type: t });
  }
  const rows = await q;
  const out = [];
  for (const row of rows) {
    const reminders = await db('event_reminders')
      .where({ event_id: row.id })
      .whereNot({ status: 'cancelled' })
      .select('id', 'offset_minutes', 'fire_at', 'status');
    out.push(mapEventOut(row, reminders));
  }
  return out;
}

async function getEvent(id, user) {
  const row = await db('events').where({ id }).first();
  if (!row) throw new AppError('رویداد یافت نشد', 404);
  if (user.role !== 'admin' && row.owner_id !== user.id) throw new AppError('رویداد یافت نشد', 404);
  const reminders = await db('event_reminders')
    .where({ event_id: row.id })
    .whereNot({ status: 'cancelled' })
    .select('id', 'offset_minutes', 'fire_at', 'status');
  return mapEventOut(row, reminders);
}

async function createEvent(body, user) {
  const data = buildPayload(body, null);
  if (!data.title || !data.date) throw new AppError('عنوان و تاریخ الزامی است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);
  if (data.client_id) await assertClientAccess(data.client_id, user);

  const offsets = data._offsets;
  delete data._offsets;

  const id = await db.transaction(async (trx) => {
    const newId = await insertReturningId(trx, 'events', {
      ...data,
      owner_id: user.id,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    const event = await trx('events').where({ id: newId }).first();
    await emitEventNotification('event_created', event, user, trx);
    return newId;
  });

  const event = await db('events').where({ id }).first();
  event._offsets = offsets;
  if (event.status === 'scheduled') {
    await rebuildRemindersForEvent(event);
  }
  return getEvent(id, user);
}

async function updateEvent(id, body, user) {
  const existing = await db('events').where({ id }).first();
  if (!existing) throw new AppError('رویداد یافت نشد', 404);
  if (user.role !== 'admin' && existing.owner_id !== user.id) throw new AppError('رویداد یافت نشد', 404);

  const data = buildPayload(body, existing);
  if (!data.title || !data.date) throw new AppError('عنوان و تاریخ الزامی است', 400);
  if (data.case_id) await assertCaseAccess(data.case_id, user);
  if (data.client_id) await assertClientAccess(data.client_id, user);

  const offsets = data._offsets;
  delete data._offsets;

  await db.transaction(async (trx) => {
    await trx('events').where({ id }).update({
      ...data,
      updated_at: db.fn.now()
    });
    const event = await trx('events').where({ id }).first();
    await emitEventNotification('event_updated', event, user, trx);
  });

  const event = await db('events').where({ id }).first();
  if (event.status === 'cancelled' || event.status === 'done') {
    await cancelRemindersForEvent(event.id);
  } else {
    event._offsets = offsets;
    await rebuildRemindersForEvent(event);
  }
  return getEvent(id, user);
}

async function deleteEvent(id, user) {
  const existing = await db('events').where({ id }).first();
  if (!existing) throw new AppError('رویداد یافت نشد', 404);
  if (user.role !== 'admin' && existing.owner_id !== user.id) {
    throw new AppError('رویداد یافت نشد', 404);
  }

  await db.transaction(async (trx) => {
    await emitEventNotification('event_deleted', existing, user, trx);
    await cancelRemindersForEvent(id, trx);
    await trx('events').where({ id }).del();
  });
  return { ok: true };
}

module.exports = {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  TYPE_ALIASES,
  STATUSES
};
