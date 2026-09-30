/**
 * Event reminders + channel delivery + IDOR tests (in-process).
 */
require('dotenv').config();
const webpush = require('web-push');
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@legal.local';
}
const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { processDueReminders } = require('../src/services/reminder.service');
const { toDbDateTime } = require('../src/utils/dbHelpers');
const { computeFireAtUtc } = require('../src/utils/timezone');
const { setReminderChannel } = require('../src/services/reminderChannels');
const { ReminderChannelInterface } = require('../src/services/reminderChannels/ReminderChannelInterface');

const results = [];
let PORT = 0;
let server;

/** Parse DB DATETIME (UTC, no Z) without treating it as local wall-clock. */
function parseDbUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  return new Date(s);
}

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, path, method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({ status: res.statusCode, body: json, text: raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function auth(token) { return { Authorization: 'Bearer ' + token }; }

class CapturePushChannel extends ReminderChannelInterface {
  constructor() {
    super();
    this.sent = [];
  }
  get name() { return 'push'; }
  isEnabled() { return true; }
  async canDeliver() { return true; }
  async deliver(payload) {
    this.sent.push(payload);
    return { ok: true };
  }
}

async function main() {
  await db.migrate.latest();

  const capture = new CapturePushChannel();
  setReminderChannel('push', capture);

  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nEvent reminder tests → :${PORT}\n`);

  const suffix = Date.now();
  const reg = await req('POST', '/api/register', {
    name: 'یادآور تست',
    email: `rem.${suffix}@test.local`,
    password: 'ReminderPass99',
    role: 'lawyer'
  });
  assert('register', reg.status === 201 || reg.status === 200, String(reg.status));
  const token = reg.body.accessToken || reg.body.token;
  const userId = reg.body.user.id;

  // Legacy type + legacy reminder still works
  // Use +3 days so multi-offset reminders (incl. 1440m) stay in the future
  const future = new Date(Date.now() + 3 * 86400000);
  const y = future.getUTCFullYear();
  const m = String(future.getUTCMonth() + 1).padStart(2, '0');
  const d = String(future.getUTCDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  const created = await req('POST', '/api/events', {
    title: 'جلسه دادگاه تست',
    date: dateStr,
    time: '10:30',
    type: 'court',
    reminder: 60,
    note: 'توضیح',
    timezone: 'Asia/Tehran'
  }, auth(token));
  assert('create event legacy type/reminder', created.status === 201, `status ${created.status} ${created.body?.error}`);
  assert('type normalized court_hearing', created.body.type === 'court_hearing', created.body.type);
  assert('legacy reminder kept', created.body.reminder === 60);
  assert('reminder_offsets has 60', Array.isArray(created.body.reminder_offsets) && created.body.reminder_offsets.includes(60));
  const eventId = created.body.id;

  const list = await req('GET', '/api/events', null, auth(token));
  assert('GET /api/events intact', list.status === 200 && Array.isArray(list.body));

  const getOne = await req('GET', `/api/events/${eventId}`, null, auth(token));
  assert('GET /api/events/:id intact', getOne.status === 200 && getOne.body.id === eventId);

  // Timezone fire_at — compare as UTC (DB stores DATETIME without Z)
  const expectedFire = computeFireAtUtc(dateStr, '10:30', 'Asia/Tehran', 60);
  const remRow = await db('event_reminders').where({ event_id: eventId }).first();
  assert('reminder row created', !!remRow);
  const storedFire = remRow ? parseDbUtc(remRow.fire_at) : null;
  assert(
    'fire_at respects timezone',
    storedFire && Math.abs(storedFire.getTime() - expectedFire.getTime()) < 2000,
    `${remRow && remRow.fire_at} vs ${expectedFire.toISOString()}`
  );

  // Multi offsets
  const multi = await req('POST', '/api/events', {
    title: 'مهلت مدرک',
    date: dateStr,
    time: '15:00',
    type: 'document_deadline',
    reminders: [1440, 180, 30],
    timezone: 'Asia/Tehran'
  }, auth(token));
  assert('create with reminders[]', multi.status === 201, String(multi.status));
  const multiRems = await db('event_reminders').where({ event_id: multi.body.id });
  assert('3 reminder offsets', multiRems.length === 3, `count ${multiRems.length}`);

  // Dashboard feed without push dependency
  const todayFeed = await req('GET', '/api/reminders/today', null, auth(token));
  const upFeed = await req('GET', '/api/reminders/upcoming', null, auth(token));
  assert('reminders upcoming API', upFeed.status === 200 && Array.isArray(upFeed.body) && upFeed.body.length >= 1);
  assert('reminders today API', todayFeed.status === 200 && Array.isArray(todayFeed.body));

  // Force due + process (idempotent) — use toDbDateTime so SQL compare matches writers
  await db('event_reminders').where({ event_id: eventId }).update({
    fire_at: toDbDateTime(new Date(Date.now() - 1000)),
    status: 'pending'
  });
  capture.sent = [];
  const r1 = await processDueReminders({ limit: 20 });
  assert('process due reminders', r1.processed >= 1, `processed=${r1.processed} due=${r1.due}`);
  assert('push channel delivered once', capture.sent.length >= 1, `sent ${capture.sent.length}`);
  const sentCount1 = capture.sent.length;
  await processDueReminders({ limit: 20 });
  assert('duplicate delivery prevented', capture.sent.length === sentCount1, `sent ${capture.sent.length}`);
  const deliveries = await db('reminder_deliveries').where({ channel: 'push' }).whereIn(
    'reminder_id',
    db('event_reminders').select('id').where({ event_id: eventId })
  );
  assert('one delivery row per reminder/channel', deliveries.length >= 1);
  assert('delivery status sent', deliveries.every((d) => d.status === 'sent' || d.status === 'skipped'));

  // Cancelled event — no send
  const cancelEv = await req('POST', '/api/events', {
    title: 'لغو شونده',
    date: dateStr,
    time: '12:00',
    type: 'personal',
    reminder: 30,
    timezone: 'Asia/Tehran'
  }, auth(token));
  await db('event_reminders').where({ event_id: cancelEv.body.id }).update({
    fire_at: toDbDateTime(new Date(Date.now() - 1000)),
    status: 'pending'
  });
  await req('PUT', `/api/events/${cancelEv.body.id}`, {
    title: 'لغو شونده',
    date: dateStr,
    time: '12:00',
    type: 'personal',
    status: 'cancelled',
    reminder: 30
  }, auth(token));
  capture.sent = [];
  await processDueReminders({ limit: 20 });
  const cancelledRem = await db('event_reminders').where({ event_id: cancelEv.body.id }).first();
  assert('cancelled reminder not pending', cancelledRem && cancelledRem.status === 'cancelled', cancelledRem && cancelledRem.status);
  assert('cancelled event not delivered', capture.sent.length === 0, `sent ${capture.sent.length}`);

  // Deleted event
  const delEv = await req('POST', '/api/events', {
    title: 'حذف شونده',
    date: dateStr,
    time: '13:00',
    type: 'deadline',
    reminder: 30,
    timezone: 'Asia/Tehran'
  }, auth(token));
  const delId = delEv.body.id;
  await req('DELETE', `/api/events/${delId}`, null, auth(token));
  const afterDel = await db('event_reminders').where({ event_id: delId });
  assert('deleted event reminders removed', afterDel.length === 0);

  // Past event — no future reminder rows
  const past = await req('POST', '/api/events', {
    title: 'رویداد گذشته',
    date: '2020-01-01',
    time: '09:00',
    type: 'personal',
    reminder: 60,
    timezone: 'Asia/Tehran'
  }, auth(token));
  const pastRems = await db('event_reminders').where({ event_id: past.body.id });
  assert('past event no pending reminders', pastRems.length === 0, `count ${pastRems.length}`);

  // Unauthorized / IDOR
  const other = await req('POST', '/api/register', {
    name: 'دیگر',
    email: `other.rem.${suffix}@test.local`,
    password: 'OtherPass99',
    role: 'lawyer'
  });
  const otherToken = other.body.accessToken || other.body.token;
  const idor = await req('GET', `/api/events/${eventId}`, null, auth(otherToken));
  assert('IDOR get event → 404', idor.status === 404);

  // Push subscribe IDOR
  const vapid = await req('GET', '/api/push/vapid-public-key');
  assert('vapid public key', vapid.status === 200 && !!vapid.body.publicKey);
  const endpoint = `https://push.example.test/sub/${suffix}`;
  const sub1 = await req('POST', '/api/push/subscribe', {
    endpoint,
    keys: { p256dh: 'dGVzdC1wMjU2ZGg=', auth: 'dGVzdC1hdXRo' }
  }, auth(token));
  assert('push subscribe', sub1.status === 201 || sub1.status === 200, String(sub1.status));
  const sub2 = await req('POST', '/api/push/subscribe', {
    endpoint,
    keys: { p256dh: 'eHh4', auth: 'eXl5' }
  }, auth(otherToken));
  assert('push subscribe IDOR → 403', sub2.status === 403, String(sub2.status));

  const unauth = await req('POST', '/api/push/subscribe', { endpoint: endpoint + '/x', keys: { p256dh: 'a', auth: 'b' } });
  assert('push subscribe بدون login → 401', unauth.status === 401);

  // PUT delete intact
  const upd = await req('PUT', `/api/events/${eventId}`, {
    title: 'جلسه دادگاه تست به‌روز',
    date: dateStr,
    time: '11:00',
    type: 'court_hearing',
    reminder: 180
  }, auth(token));
  assert('PUT /api/events/:id intact', upd.status === 200 && upd.body.reminder === 180);

  // Cleanup
  try {
    await db('reminder_deliveries').del();
    await db('event_reminders').where({ owner_id: userId }).del();
    await db('event_reminders').where({ owner_id: other.body.user.id }).del();
    await db('events').whereIn('owner_id', [userId, other.body.user.id]).del();
    await db('push_subscriptions').whereIn('user_id', [userId, other.body.user.id]).del();
    await db('refresh_tokens').whereIn('user_id', [userId, other.body.user.id]).del();
    await db('users').whereIn('id', [userId, other.body.user.id]).del();
  } catch { /* ignore */ }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${passed} passed / ${failed} failed / ${results.length} total ===\n`);
  await new Promise((r) => server.close(r));
  await db.destroy();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { if (server) await new Promise((r) => server.close(r)); await db.destroy(); } catch { /* ignore */ }
  process.exit(1);
});
