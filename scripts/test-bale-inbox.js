/**
 * Bale Inbox — list, threads, read, reply, ownership, rate limit (mocked Bale API).
 */
require('dotenv').config();

const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { BALE_API_BASE } = require('../src/services/messengers/BaleService');
const { persistBaleMessage } = require('../src/services/baleInbox.service');

let PORT = 0;
let server;
const results = [];
const FAKE_TOKEN = '123456789:AAFakeBaleTokenInboxTests';
const calls = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
          resolve({ status: res.statusCode, body: json, raw, headers: res.headers });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

async function registerLawyer(tag) {
  const email = `inbox.${tag}.${Date.now()}@test.local`;
  const password = 'InboxTestPass99!';
  await req('POST', '/api/register', { name: 'Inbox ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  const user = await db('users').where({ email }).first();
  return { token: login.body.accessToken, userId: user.id, email };
}

function installBaleFetchMock() {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    const u = String(url);
    if (!u.startsWith(BALE_API_BASE)) return original(url, options);
    if (u.includes('/getMe')) {
      return { ok: true, json: async () => ({ ok: true, result: { id: 1, username: 'inboxbot' } }) };
    }
    if (u.includes('/sendMessage')) {
      let payload = {};
      try { payload = JSON.parse(options.body || '{}'); } catch { payload = {}; }
      if (payload.text === 'trigger-bale-fail') {
        return {
          ok: true,
          json: async () => ({ ok: false, error_code: 400, description: 'chat not found' })
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 99001, chat: { id: payload.chat_id }, text: payload.text }
        })
      };
    }
    if (u.includes('/setWebhook') || u.includes('/deleteWebhook') || u.includes('/getUpdates')) {
      return { ok: true, json: async () => ({ ok: true, result: u.includes('/getUpdates') ? [] : true }) };
    }
    return { ok: true, json: async () => ({ ok: false, error_code: 404, description: 'not mocked' }) };
  };
  return () => { global.fetch = original; };
}

async function seedInbound(commId, messageId, chatId, opts = {}) {
  return persistBaleMessage(commId, {
    external_message_id: String(messageId),
    chat_id: String(chatId),
    direction: 'inbound',
    sender_first_name: opts.name != null ? opts.name : 'Client',
    text: opts.text || 'سلام',
    read_at: opts.read_at || null
  });
}

async function main() {
  process.env.BALE_INBOUND_POLLING = 'false';
  process.env.BALE_REPLY_RATE_MAX = '30';
  const restoreFetch = installBaleFetchMock();

  await db.migrate.latest();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const lawyerA = await registerLawyer('a');
  const lawyerB = await registerLawyer('b');

  const noAuth = await req('GET', '/api/communications/bale/messages');
  assert('auth required messages', noAuth.status === 401);

  await req('POST', '/api/communications/connect', { platform: 'bale', token: FAKE_TOKEN }, auth(lawyerA.token));
  await req('POST', '/api/communications/connect', { platform: 'bale', token: FAKE_TOKEN + 'B' }, auth(lawyerB.token));

  const commA = await db('communications').where({ owner_id: lawyerA.userId, platform: 'bale' }).first();
  const commB = await db('communications').where({ owner_id: lawyerB.userId, platform: 'bale' }).first();
  assert('two bale comms', commA && commB && commA.id !== commB.id);

  await seedInbound(commA.id, 1001, '111', { text: 'پیام اول', name: 'Ali' });
  await seedInbound(commA.id, 1002, '111', { text: 'پیام دوم' });
  await seedInbound(commA.id, 1003, '222', { text: 'گفتگوی دیگر', name: 'Sara' });

  const list = await req('GET', '/api/communications/bale/messages?limit=2&page=1', null, auth(lawyerA.token));
  assert('list messages 200', list.status === 200);
  assert('list pagination total', list.body.total >= 3);
  assert('list page size', list.body.items.length === 2);
  assert('list newest first', new Date(list.body.items[0].created_at) >= new Date(list.body.items[1].created_at));
  assert('list no token leak', !list.raw.includes(FAKE_TOKEN) && !list.raw.includes('token_enc'));

  const page2 = await req('GET', '/api/communications/bale/messages?limit=2&page=2', null, auth(lawyerA.token));
  assert('pagination page2', page2.body.items.length >= 1);

  const threads = await req('GET', '/api/communications/bale/threads', null, auth(lawyerA.token));
  assert('threads 200', threads.status === 200);
  assert('threads grouping', threads.body.threads.length === 2);
  const t111 = threads.body.threads.find((t) => t.chat_id === '111');
  assert('thread unread count', t111 && t111.unread_count === 2);
  assert('thread display name', t111 && t111.display_name === 'Client');

  const idor = await req('GET', '/api/communications/bale/messages?chat_id=111', null, auth(lawyerB.token));
  assert('ownership empty for B', idor.body.total === 0 || idor.body.items.length === 0);

  const msgRow = await db('communication_inbound_messages').where({ communication_id: commA.id, external_message_id: '1001' }).first();
  const read1 = await req('PATCH', `/api/communications/bale/messages/${msgRow.id}/read`, null, auth(lawyerA.token));
  assert('mark read 200', read1.status === 200 && read1.body.read_at);
  const read2 = await req('PATCH', `/api/communications/bale/messages/${msgRow.id}/read`, null, auth(lawyerA.token));
  assert('mark read idempotent', read2.status === 200 && read2.body.already === true);

  const idorRead = await req('PATCH', `/api/communications/bale/messages/${msgRow.id}/read`, null, auth(lawyerB.token));
  assert('IDOR mark read 404', idorRead.status === 404);

  const emptyText = await req('POST', '/api/communications/bale/reply', { chat_id: '111', text: '   ' }, auth(lawyerA.token));
  assert('validation empty text', emptyText.status === 400);

  const longText = await req('POST', '/api/communications/bale/reply', {
    chat_id: '111',
    text: 'x'.repeat(5000)
  }, auth(lawyerA.token));
  assert('validation long text', longText.status === 400);

  const badChat = await req('POST', '/api/communications/bale/reply', { chat_id: 'bad id!', text: 'hi' }, auth(lawyerA.token));
  assert('validation bad chat_id', badChat.status === 400);

  const replyOk = await req('POST', '/api/communications/bale/reply', { chat_id: '111', text: 'پاسخ وکیل' }, auth(lawyerA.token));
  assert('reply success', replyOk.status === 200 && replyOk.body.sent === true);
  assert('reply outbound stored', replyOk.body.message && replyOk.body.message.direction === 'outbound');
  assert('reply no token in response', !replyOk.raw.includes(FAKE_TOKEN));

  const outboundDb = await db('communication_inbound_messages')
    .where({ communication_id: commA.id, external_message_id: '99001' })
    .first();
  assert('outbound in db', outboundDb && outboundDb.direction === 'outbound');

  const dup = await persistBaleMessage(commA.id, {
    external_message_id: '99001',
    chat_id: '111',
    direction: 'outbound',
    text: 'dup'
  });
  assert('duplicate prevented', dup.status === 'duplicate');

  const replyFail = await req('POST', '/api/communications/bale/reply', {
    chat_id: '111',
    text: 'trigger-bale-fail'
  }, auth(lawyerA.token));
  assert('reply bale error mapped', replyFail.status === 400);
  assert('reply fail no token leak', !replyFail.raw.includes(FAKE_TOKEN));

  process.env.BALE_REPLY_RATE_MAX = '3';
  const lawyerC = await registerLawyer('c-rate');
  const connectC = await req('POST', '/api/communications/connect', { platform: 'bale', token: FAKE_TOKEN + 'C' }, auth(lawyerC.token));
  assert('lawyer C connect', connectC.status === 200, String(connectC.status));
  const commC = await db('communications').where({ owner_id: lawyerC.userId, platform: 'bale' }).first();
  await seedInbound(commC.id, 2001, '333', { text: 'rate test' });
  for (let i = 0; i < 3; i += 1) {
    const r = await req('POST', '/api/communications/bale/reply', { chat_id: '333', text: 'rate ' + i }, auth(lawyerC.token));
    assert('rate reply ' + i, r.status === 200, String(r.status));
  }
  const rateLimited = await req('POST', '/api/communications/bale/reply', { chat_id: '333', text: 'rate block' }, auth(lawyerC.token));
  assert('reply rate limit', rateLimited.status === 429, String(rateLimited.status));

  restoreFetch();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? 'FAIL' : 'PASS') + `  bale-inbox ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
