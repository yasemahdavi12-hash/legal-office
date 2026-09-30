const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { insertReturningId, toDbDateTime } = require('../utils/dbHelpers');
const { computeFireAtUtc, localToday, DEFAULT_TIMEZONE } = require('../utils/timezone');
const { getEnabledChannels } = require('./reminderChannels');
const { safeLog } = require('../utils/logger');

const EVENT_TYPE_LABELS = {
  court_hearing: 'دادگاه',
  client_meeting: 'جلسه موکل',
  client_call: 'تماس موکل',
  deadline: 'مهلت',
  document_deadline: 'مهلت مدرک',
  payment_due: 'سررسید پرداخت',
  internal_meeting: 'جلسه داخلی',
  personal: 'شخصی',
  // legacy
  meeting: 'جلسه',
  court: 'دادگاه',
  supervision: 'وقت نظارت',
  reminder: 'یادآوری'
};

const PRESET_OFFSETS = new Set([1440, 180, 60, 30]);

function normalizeOffsets(body = {}) {
  const offsets = new Set();
  if (Array.isArray(body.reminders)) {
    for (const v of body.reminders) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n <= 60 * 24 * 30) offsets.add(Math.floor(n));
    }
  }
  if (Array.isArray(body.reminder_offsets)) {
    for (const v of body.reminder_offsets) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n <= 60 * 24 * 30) offsets.add(Math.floor(n));
    }
  }
  // Legacy single reminder / remind (minutes)
  const legacy = body.reminder != null ? Number(body.reminder) : (body.remind != null ? Number(body.remind) : null);
  if (legacy != null && Number.isFinite(legacy) && legacy > 0) {
    offsets.add(Math.floor(legacy));
  }
  return Array.from(offsets).sort((a, b) => b - a);
}

async function rebuildRemindersForEvent(event, trx = db) {
  await trx('event_reminders').where({ event_id: event.id }).del();

  if (!event || event.status === 'cancelled' || event.status === 'done') {
    return [];
  }

  const offsets = [];
  if (event.reminder != null && Number(event.reminder) > 0) {
    offsets.push(Number(event.reminder));
  }
  // Also load from a temp property if present
  if (Array.isArray(event._offsets)) {
    for (const o of event._offsets) {
      if (o > 0) offsets.push(o);
    }
  }
  const unique = Array.from(new Set(offsets.filter((o) => o > 0)));
  const tz = event.timezone || DEFAULT_TIMEZONE;
  const now = Date.now();
  const created = [];

  for (const offset of unique) {
    let fireAt;
    try {
      fireAt = computeFireAtUtc(event.date, event.time, tz, offset);
    } catch {
      continue;
    }
    // Skip reminders that would fire in the past relative to creation (past events)
    if (fireAt.getTime() < now - 60 * 1000) {
      continue;
    }
    const id = await insertReturningId(trx, 'event_reminders', {
      event_id: event.id,
      owner_id: event.owner_id,
      offset_minutes: offset,
      fire_at: toDbDateTime(fireAt),
      status: 'pending',
      created_at: trx.fn.now()
    });
    created.push({ id, offset_minutes: offset, fire_at: toDbDateTime(fireAt) });
  }
  return created;
}

async function cancelRemindersForEvent(eventId, trx = db) {
  const reminders = await trx('event_reminders').where({ event_id: eventId }).select('id');
  await trx('event_reminders').where({ event_id: eventId }).update({ status: 'cancelled' });
  const ids = reminders.map((r) => r.id);
  if (ids.length) {
    await trx('reminder_deliveries')
      .whereIn('reminder_id', ids)
      .where({ status: 'pending' })
      .update({ status: 'skipped', error: 'event_cancelled' });
  }
}

function buildMessage(event, caseRow, clientRow) {
  const typeLabel = EVENT_TYPE_LABELS[event.type] || 'رویداد';
  const when = `${event.date || ''}${event.time ? ' در ساعت ' + event.time : ''}`.trim();
  const subject = caseRow?.title
    ? `پرونده ${caseRow.title}`
    : (clientRow?.name ? `موکل ${clientRow.name}` : null);
  const title = `🔔 یادآوری ${typeLabel}`;
  let body = `«${event.title}»`;
  if (subject) body = `${subject} — ${body}`;
  if (event.time) body += ` — ${when}`;
  else body += ` — تاریخ ${event.date}`;
  return { title, body, typeLabel };
}

async function claimDelivery(reminderId, channel) {
  const key = `${reminderId}:${channel}`;
  try {
    const id = await insertReturningId(db, 'reminder_deliveries', {
      reminder_id: reminderId,
      channel,
      status: 'pending',
      idempotency_key: key,
      created_at: db.fn.now()
    });
    return { claimed: true, id, key };
  } catch (err) {
    // Unique violation → already claimed/sent
    const existing = await db('reminder_deliveries').where({ idempotency_key: key }).first();
    return { claimed: false, existing };
  }
}

/**
 * Process due reminders — channel-agnostic; only enabled channels deliver.
 */
async function processDueReminders({ limit = 50 } = {}) {
  const nowIso = toDbDateTime();
  const due = await db('event_reminders')
    .where({ status: 'pending' })
    .where('fire_at', '<=', nowIso)
    .orderBy('fire_at', 'asc')
    .limit(limit);

  const channels = getEnabledChannels();
  let processed = 0;

  for (const reminder of due) {
    const event = await db('events').where({ id: reminder.event_id }).first();
    if (!event || event.status === 'cancelled' || event.status === 'done') {
      await db('event_reminders').where({ id: reminder.id }).update({ status: 'cancelled' });
      continue;
    }

    // Event already in the past beyond the reminder window — still deliver if fire_at due
    let caseRow = null;
    let clientRow = null;
    if (event.case_id) caseRow = await db('cases').where({ id: event.case_id }).first();
    if (event.client_id) clientRow = await db('clients').where({ id: event.client_id }).first();
    const msg = buildMessage(event, caseRow, clientRow);

    if (!channels.length) {
      // No delivery channel enabled — mark completed so dashboard still shows history via fire_at
      // Keep pending? Better: leave pending until a channel exists, OR mark completed for dashboard-only.
      // Requirement: dashboard shows reminders without push. So complete without channel is OK after fire.
      await db('event_reminders').where({ id: reminder.id }).update({ status: 'completed' });
      processed += 1;
      continue;
    }

    let allDone = true;
    for (const channel of channels) {
      const can = await channel.canDeliver(reminder.owner_id);
      const claim = await claimDelivery(reminder.id, channel.name);
      if (!claim.claimed) {
        if (claim.existing && claim.existing.status === 'pending') {
          // Another worker holds it — skip
          allDone = false;
        }
        continue;
      }

      if (!can) {
        await db('reminder_deliveries').where({ id: claim.id }).update({
          status: 'skipped',
          error: 'channel_unavailable',
          sent_at: db.fn.now()
        });
        continue;
      }

      try {
        const result = await channel.deliver({
          userId: reminder.owner_id,
          reminder,
          event,
          title: msg.title,
          body: msg.body,
          data: {
            eventId: event.id,
            type: event.type,
            date: event.date,
            time: event.time
          }
        });
        if (result.ok) {
          await db('reminder_deliveries').where({ id: claim.id }).update({
            status: 'sent',
            sent_at: db.fn.now()
          });
        } else if (result.skipped) {
          await db('reminder_deliveries').where({ id: claim.id }).update({
            status: 'skipped',
            error: result.error || 'skipped',
            sent_at: db.fn.now()
          });
        } else {
          await db('reminder_deliveries').where({ id: claim.id }).update({
            status: 'failed',
            error: result.error || 'failed',
            sent_at: db.fn.now()
          });
          allDone = false;
        }
      } catch (err) {
        safeLog('[reminder] channel error', channel.name, err && err.message);
        await db('reminder_deliveries').where({ id: claim.id }).update({
          status: 'failed',
          error: (err && err.message) || 'error',
          sent_at: db.fn.now()
        });
        allDone = false;
      }
    }

    if (allDone) {
      await db('event_reminders').where({ id: reminder.id }).update({ status: 'completed' });
    }
    processed += 1;
  }

  return { processed, due: due.length };
}

/**
 * Dashboard feed — works without push.
 */
async function listReminderFeed(user, { scope = 'upcoming', timezone } = {}) {
  const tz = timezone || DEFAULT_TIMEZONE;
  const today = localToday(tz);
  let q = db('event_reminders as r')
    .join('events as e', 'e.id', 'r.event_id')
    .leftJoin('cases as c', 'c.id', 'e.case_id')
    .leftJoin('clients as cl', 'cl.id', 'e.client_id')
    .where('r.owner_id', user.id)
    .whereNot('e.status', 'cancelled')
    .whereNot('r.status', 'cancelled')
    .select(
      'r.id as reminder_id',
      'r.offset_minutes',
      'r.fire_at',
      'r.status as reminder_status',
      'e.id as event_id',
      'e.title',
      'e.type',
      'e.date',
      'e.time',
      'e.location',
      'e.status as event_status',
      'e.timezone',
      'c.title as case_title',
      'c.case_number',
      'cl.name as client_name'
    )
    .orderBy('e.date', 'asc')
    .orderBy('e.time', 'asc');

  if (scope === 'today') {
    q = q.where('e.date', today);
  } else if (scope === 'upcoming') {
    q = q.where('e.date', '>=', today);
  } else if (scope === 'due') {
    q = q.where('r.fire_at', '<=', toDbDateTime()).where('r.status', 'pending');
  }

  const rows = await q.limit(100);
  return rows.map((row) => {
    const typeLabel = EVENT_TYPE_LABELS[row.type] || row.type;
    const subject = row.case_title
      ? `پرونده ${row.case_title}`
      : (row.client_name ? `موکل ${row.client_name}` : null);
    const text = subject
      ? `🔔 یادآوری ${typeLabel} — ${subject} — ${row.title}`
      : `🔔 یادآوری ${typeLabel} — ${row.title}`;
    return {
      reminder_id: row.reminder_id,
      event_id: row.event_id,
      offset_minutes: row.offset_minutes,
      fire_at: row.fire_at,
      reminder_status: row.reminder_status,
      type: row.type,
      type_label: typeLabel,
      title: row.title,
      date: row.date,
      time: row.time,
      location: row.location,
      case_title: row.case_title || null,
      case_number: row.case_number || null,
      client_name: row.client_name || null,
      text,
      detail: `${row.date || ''}${row.time ? ' — ' + row.time : ''}`
    };
  });
}

module.exports = {
  normalizeOffsets,
  rebuildRemindersForEvent,
  cancelRemindersForEvent,
  processDueReminders,
  listReminderFeed,
  buildMessage,
  PRESET_OFFSETS,
  EVENT_TYPE_LABELS
};
