/**
 * Bale inbound messages — webhook storage, dedupe, polling (mocked Bale API).
 */
require('dotenv').config();

const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { BALE_API_BASE } = require('../src/services/messengers/BaleService');
const {
  parseBaleUpdate,
  processBaleUpdate,
  pollSingleConnection
} = require('../src/services/baleInbound.service');

let PORT = 0;
let server;
const results = [];
const FAKE_TOKEN = '123456789:AAFakeBaleTokenForInboundTests';

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
          resolve({ status: res.statusCode, body: json, raw });
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

async function registerLawyer() {
  const email = `bale.inbound.${Date.now()}@test.local`;
  const password = 'BaleInboundTest99!';
  await req('POST', '/api/register', { name: 'Bale Inbound', email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return login.body.accessToken;
}

function sampleUpdate(messageId = 9001) {
  return {
    update_id: 100,
    message: {
      message_id: messageId,
      date: 1700000000,
      chat: { id: 555001, type: 'private' },
      from: { id: 777, username: 'client_user', first_name: 'Ali' },
      text: 'پیام تست ورودی'
    }
  };
}

function installBaleFetchMock() {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    const u = String(url);
    if (!u.startsWith(BALE_API_BASE)) {
      return original(url, options);
    }
    if (u.includes('/getMe')) {
      return { ok: true, json: async () => ({ ok: true, result: { id: 1, username: 'testbot' } }) };
    }
    if (u.includes('/getUpdates')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: [
            {
              update_id: 501,
              message: {
                message_id: 8001,
                chat: { id: 444 },
                from: { id: 1, first_name: 'Poll' },
                text: 'from poll'
              }
            }
          ]
        })
      };
    }
    if (u.includes('/setWebhook') || u.includes('/deleteWebhook')) {
      return { ok: true, json: async () => ({ ok: true, result: true }) };
    }
    return { ok: true, json: async () => ({ ok: false, error_code: 404, description: 'not mocked' }) };
  };
  return () => { global.fetch = original; };
}

async function main() {
  const restoreFetch = installBaleFetchMock();
  process.env.BALE_INBOUND_POLLING = 'false';

  await db.migrate.latest();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const token = await registerLawyer();
  const connect = await req('POST', '/api/communications/connect', {
    platform: 'bale',
    token: FAKE_TOKEN
  }, auth(token));
  assert('connect 200', connect.status === 200, String(connect.status));

  const comm = await db('communications').where({ platform: 'bale' }).orderBy('id', 'desc').first();
  assert('webhook secret set', comm && comm.inbound_webhook_secret && comm.inbound_webhook_secret.length >= 32);

  const parsed = parseBaleUpdate(sampleUpdate());
  assert('parse chat_id', parsed && parsed.chat_id === '555001');
  assert('parse sender', parsed && parsed.sender_id === '777' && parsed.sender_username === 'client_user');
  assert('parse text', parsed && parsed.text === 'پیام تست ورودی');

  const secret = comm.inbound_webhook_secret;
  const wh = await req('POST', `/api/communications/bale/webhook/${secret}`, sampleUpdate());
  assert('webhook 200', wh.status === 200, String(wh.status));
  assert('webhook stored', wh.body && wh.body.status === 'stored');
  assert('webhook no token in response', !(wh.raw || '').includes(FAKE_TOKEN));

  const rows = await db('communication_inbound_messages').where({ communication_id: comm.id });
  assert('one row in db', rows.length === 1);
  assert('db platform bale', rows[0].platform === 'bale');
  assert('db external_message_id', rows[0].external_message_id === '9001');
  assert('db chat_id', rows[0].chat_id === '555001');

  const whDup = await req('POST', `/api/communications/bale/webhook/${secret}`, sampleUpdate());
  assert('duplicate webhook 200', whDup.status === 200);
  assert('duplicate status', whDup.body && whDup.body.status === 'duplicate');
  const rows2 = await db('communication_inbound_messages').where({ communication_id: comm.id });
  assert('still one row after duplicate', rows2.length === 1);

  const whBad = await req('POST', '/api/communications/bale/webhook/invalid-secret-xyz', sampleUpdate(9002));
  assert('invalid secret 404', whBad.status === 404);

  const unitDup = await processBaleUpdate(comm, sampleUpdate());
  assert('processBaleUpdate duplicate', unitDup.status === 'duplicate');

  await pollSingleConnection(comm);
  const pollRows = await db('communication_inbound_messages').where({ communication_id: comm.id });
  assert('poll stored message', pollRows.some((r) => r.external_message_id === '8001'));
  const commAfter = await db('communications').where({ id: comm.id }).first();
  const settingsAfter = JSON.parse(commAfter.settings || '{}');
  assert('poll offset saved', settingsAfter.bale_update_offset === 502);

  restoreFetch();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? 'FAIL' : 'PASS') + `  bale-inbound ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
