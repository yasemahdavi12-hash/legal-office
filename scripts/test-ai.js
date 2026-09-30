/**
 * AI assistant tests — PRO-only gate, ownership, rate limit, provider errors.
 * In-process app; stub provider via setAiProvider (no real API calls).
 */
require('dotenv').config();
process.env.AI_DAILY_LIMIT_PRO = '20';
process.env.AI_ENABLED = 'true';
process.env.AI_API_KEY = 'test-fake-ai-key-do-not-leak';

const http = require('http');
const crypto = require('crypto');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { setAiProvider, resetAiProvider } = require('../src/services/ai');
const { DISCLAIMER, ERROR_CODE_AI_PRO } = require('../src/services/ai.service');
const { toDbDateTime } = require('../src/utils/dbHelpers');

let PORT = 0;
let server;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@legal.ir';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPass1';
const results = [];
const FAKE_KEY = 'test-fake-ai-key-do-not-leak';

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

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

function makeStub(opts = {}) {
  return {
    async chat({ user }) {
      if (opts.fail) {
        throw new Error('provider boom');
      }
      const seen = String(user || '');
      return {
        text: `پاسخ تست. زمینه=${seen.includes('پرونده:') ? 'yes' : 'no'}\n\n${DISCLAIMER}`
      };
    }
  };
}

async function registerLawyer(tag) {
  const email = `ai.${tag}@test.local`;
  const password = 'AiLawyerPass99';
  const reg = await req('POST', '/api/register', {
    name: 'وکیل AI',
    email,
    password,
    role: 'lawyer'
  });
  return {
    email,
    password,
    token: reg.body.accessToken || reg.body.token,
    userId: reg.body.user?.id,
    status: reg.status
  };
}

async function setPro(adminToken, userId, expiresAt) {
  return req(
    'PUT',
    `/api/admin/users/${userId}/subscription`,
    { plan: 'pro', expiresAt },
    auth(adminToken)
  );
}

async function main() {
  await db.migrate.latest();
  setAiProvider(makeStub());
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nAI PRO-gate tests → :${PORT}\n`);

  const existingAdmin = await db('users').where({ email: ADMIN_EMAIL }).first();
  if (!existingAdmin) {
    const bcrypt = require('bcryptjs');
    await db('users').insert({
      name: 'Admin',
      email: ADMIN_EMAIL,
      password_hash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      role: 'admin',
      token_version: 0,
      must_change_password: false,
      created_at: db.fn.now()
    });
  }

  const adminLogin = await req('POST', '/api/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  let adminToken = adminLogin.body.accessToken || adminLogin.body.token;
  if (!adminToken && adminLogin.body?.mfaRequired) {
    assert('admin login (mfa gate)', false, 'admin requires MFA in this env — use non-prod without MFA');
  }
  assert('admin login', !!adminToken, `status ${adminLogin.status}`);

  const suffix = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const free = await registerLawyer(`free.${suffix}`);
  assert('register FREE lawyer', (free.status === 200 || free.status === 201) && !!free.token);

  // 1) FREE → reject
  const freeChat = await req('POST', '/api/ai/chat', { message: 'سلام' }, auth(free.token));
  assert(
    '1 FREE → chat reject 403',
    freeChat.status === 403 && /دستیار هوشمند فقط در پلن PRO/.test(freeChat.body?.error || ''),
    `status ${freeChat.status} msg=${freeChat.body?.error}`
  );
  assert('1b FREE code AI_PRO_REQUIRED', freeChat.body?.details?.code === ERROR_CODE_AI_PRO);

  // 2) FREE + forged plan
  const fakePlan = await req(
    'POST',
    '/api/ai/chat',
    { message: 'سلام', plan: 'pro', subscription_plan: 'pro' },
    auth(free.token)
  );
  assert('2 FREE forged plan → reject', fakePlan.status === 403, `status ${fakePlan.status}`);

  // Promote PRO
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const setProRes = await setPro(adminToken, free.userId, future);
  assert('admin set PRO', setProRes.status === 200, `status ${setProRes.status}`);

  // 3) PRO success
  const proChat = await req('POST', '/api/ai/chat', { message: 'مهلت تجدیدنظر؟' }, auth(free.token));
  assert('3 PRO → success', proChat.status === 200 && !!proChat.body?.reply, `status ${proChat.status}`);
  assert('3b disclaimer', String(proChat.body?.reply || '').includes(DISCLAIMER));
  assert(
    '11 no API key in response',
    !JSON.stringify(proChat.body || {}).includes(FAKE_KEY) && !String(proChat.raw || '').includes(FAKE_KEY)
  );

  // 5) own case
  const myCase = await req('POST', '/api/cases', {
    case_number: `AI-${crypto.randomBytes(2).toString('hex')}`,
    title: 'پرونده AI خودم',
    description: 'شرح محرمانه تست'
  }, auth(free.token));
  const myCaseId = myCase.body?.id;
  assert('create own case', myCase.status === 201 || myCase.status === 200, `status ${myCase.status}`);

  const withCtx = await req(
    'POST',
    '/api/ai/chat',
    { message: 'خلاصه کن', caseId: myCaseId },
    auth(free.token)
  );
  assert(
    '5 PRO own case context → success',
    withCtx.status === 200 && /زمینه=yes/.test(withCtx.body?.reply || ''),
    `status ${withCtx.status}`
  );

  // 6) other case IDOR
  const other = await registerLawyer(`other.${suffix}`);
  await setPro(adminToken, other.userId, future);
  const otherCase = await req('POST', '/api/cases', {
    case_number: `OT-${crypto.randomBytes(2).toString('hex')}`,
    title: 'پرونده دیگران'
  }, auth(other.token));
  const idor = await req(
    'POST',
    '/api/ai/chat',
    { message: 'از این پرونده بگو', caseId: otherCase.body?.id },
    auth(free.token)
  );
  assert('6 other user case → reject', idor.status === 404 || idor.status === 403, `status ${idor.status}`);

  // 7) no auth
  const noAuth = await req('POST', '/api/ai/chat', { message: 'hi' });
  assert('7 unauthenticated → 401', noAuth.status === 401, `status ${noAuth.status}`);

  // 4) expired PRO
  await db('users').where({ id: free.userId }).update({
    subscription_plan: 'pro',
    subscription_expires_at: toDbDateTime(new Date(Date.now() - 86400000))
  });
  const expired = await req('POST', '/api/ai/chat', { message: 'بعد از انقضا' }, auth(free.token));
  assert('4 expired PRO → reject', expired.status === 403, `status ${expired.status}`);

  await db('users').where({ id: free.userId }).update({
    subscription_plan: 'pro',
    subscription_expires_at: toDbDateTime(new Date(Date.now() + 7 * 86400000))
  });

  // 8) AI disabled — before burning rate budget on provider tests
  setAiProvider(null);
  const disabled = await req('POST', '/api/ai/chat', { message: 'سرویس خاموش' }, auth(free.token));
  assert('8 AI disabled → 503', disabled.status === 503, `status ${disabled.status}`);

  // 10) provider error — no crash
  setAiProvider(makeStub({ fail: true }));
  const boom = await req('POST', '/api/ai/chat', { message: 'خطا' }, auth(free.token));
  assert('10 provider error → 502 controlled', boom.status === 502, `status ${boom.status}`);
  setAiProvider(makeStub());

  // 9) rate limit — dedicated user; temporarily use low max via many requests against limit 20
  // Re-create limiter isolation: fire 21 chats (AI_DAILY_LIMIT_PRO=20)
  const rateUser = await registerLawyer(`rate.${suffix}`);
  await setPro(adminToken, rateUser.userId, future);
  let last = null;
  for (let i = 0; i < 21; i++) {
    last = await req('POST', '/api/ai/chat', { message: `نرخ ${i}` }, auth(rateUser.token));
    if (last.status === 429) break;
  }
  assert('9 rate limit → 429', last.status === 429, `status ${last.status}`);

  // Frontend must not embed key (avoid false positive on CSS class "task-item")
  const idx = await req('GET', '/');
  const html = String(idx.raw || '');
  assert(
    '11b index.html has no AI secrets',
    !html.includes(FAKE_KEY) && !html.includes('AI_API_KEY') && !/sk-[a-zA-Z0-9]{16,}/.test(html)
  );

  // Cleanup
  try {
    const ids = [free.userId, other.userId, rateUser.userId].filter(Boolean);
    await db('subscription_events').whereIn('user_id', ids).del();
    await db('refresh_tokens').whereIn('user_id', ids).del();
    await db('notes').whereIn('owner_id', ids).del();
    await db('clients').whereIn('owner_id', ids).del();
    await db('cases').whereIn('owner_id', ids).del();
    await db('users').whereIn('id', ids).del();
  } catch { /* ignore */ }

  resetAiProvider();
  await new Promise((r) => server.close(r));

  const failed = results.filter((x) => !x.ok);
  console.log(`\n=== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total ===\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try { resetAiProvider(); } catch { /* */ }
  try { if (server) await new Promise((r) => server.close(r)); } catch { /* */ }
  process.exit(1);
});
