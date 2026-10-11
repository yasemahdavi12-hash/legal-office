/**
 * Communications — Bale connect persistence, send (mocked HTTP), disconnect.
 */
require('dotenv').config();

const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { decryptCommToken } = require('../src/services/communication.service');
const { BALE_API_BASE } = require('../src/services/messengers/BaleService');

let PORT = 0;
let server;
const results = [];
const FAKE_TOKEN = '123456789:AAFakeBaleTokenForTestsOnly';
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

async function registerLawyer(tag) {
  const email = `comm.${tag}.${Date.now()}@test.local`;
  const password = 'CommTestPass99!';
  await req('POST', '/api/register', { name: 'Comm ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return { email, token: login.body.accessToken };
}

function installBaleFetchMock() {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    const u = String(url);
    if (!u.startsWith(BALE_API_BASE)) {
      return original(url, options);
    }
    if (u.includes('/getMe')) {
      if (u.includes('bad-token')) {
        return {
          ok: true,
          json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' })
        };
      }
      return {
        ok: true,
        json: async () => ({ ok: true, result: { id: 1, username: 'testbot', is_bot: true } })
      };
    }
    if (u.includes('/setWebhook') || u.includes('/deleteWebhook') || u.includes('/getUpdates')) {
      return { ok: true, json: async () => ({ ok: true, result: u.includes('/getUpdates') ? [] : true }) };
    }
    if (u.includes('/sendMessage')) {
      let payload = {};
      try { payload = JSON.parse(options.body || '{}'); } catch { payload = {}; }
      if (payload.text === 'trigger-fail') {
        return {
          ok: true,
          json: async () => ({ ok: false, error_code: 400, description: 'chat not found' })
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 42, chat: { id: payload.chat_id }, text: payload.text }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({ ok: false, error_code: 404, description: 'method not found' })
    };
  };
  return () => { global.fetch = original; };
}

async function main() {
  const restoreFetch = installBaleFetchMock();

  await db.migrate.latest();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const lawyer = await registerLawyer('bale');

  const connect = await req('POST', '/api/communications/connect', {
    platform: 'bale',
    token: FAKE_TOKEN
  }, auth(lawyer.token));
  assert('connect 200', connect.status === 200, String(connect.status));

  const row = await db('communications').where({ platform: 'bale' }).orderBy('id', 'desc').first();
  const settings = row && JSON.parse(row.settings || '{}');
  assert('connect persists token_enc', !!(settings && settings.token_enc));
  assert('connect no plain token in db', !settings.token);
  assert('connect is_connected', row && row.is_connected === 1);

  const decrypted = decryptCommToken(settings.token_enc);
  assert('send uses persisted token', decrypted === FAKE_TOKEN);

  const list = await req('GET', '/api/communications', null, auth(lawyer.token));
  const listRaw = list.raw || '';
  assert('list hides token', !listRaw.includes(FAKE_TOKEN) && !listRaw.includes('token_enc'));

  const sendOk = await req('POST', '/api/communications/send', {
    platform: 'bale',
    target: '987654321',
    text: 'سلام از دادبان'
  }, auth(lawyer.token));
  assert('send success not 501', sendOk.status === 200 && sendOk.body?.sent === true, String(sendOk.status));

  const lastSend = calls.filter((c) => c.url.includes('sendMessage')).pop();
  let sendBody = {};
  try { sendBody = JSON.parse(lastSend?.body || '{}'); } catch { /* ignore */ }
  assert('send calls Bale sendMessage', lastSend && lastSend.url.includes(`${BALE_API_BASE}${FAKE_TOKEN}/sendMessage`));
  assert('send payload chat_id', sendBody.chat_id === 987654321);
  assert('send payload text', sendBody.text === 'سلام از دادبان');

  const sendFail = await req('POST', '/api/communications/send', {
    platform: 'bale',
    target: '1',
    text: 'trigger-fail'
  }, auth(lawyer.token));
  assert('send API failure mapped', sendFail.status === 400, String(sendFail.status));
  assert('send error no token leak', !(sendFail.raw || '').includes(FAKE_TOKEN));

  const disc = await req('POST', '/api/communications/disconnect', { platform: 'bale' }, auth(lawyer.token));
  assert('disconnect 200', disc.status === 200, String(disc.status));
  const row2 = await db('communications').where({ id: row.id }).first();
  const settings2 = JSON.parse(row2.settings || '{}');
  assert('disconnect clears token_enc', !settings2.token_enc);
  assert('disconnect is_connected false', row2.is_connected === 0);

  const sendAfterDisc = await req('POST', '/api/communications/send', {
    platform: 'bale',
    target: '1',
    text: 'x'
  }, auth(lawyer.token));
  assert('send blocked when disconnected', sendAfterDisc.status === 400, String(sendAfterDisc.status));

  restoreFetch();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? 'FAIL' : 'PASS') + `  communications ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
