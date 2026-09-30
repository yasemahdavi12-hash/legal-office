/**
 * Subscription quota tests — FREE limit = TOTAL cases (any status).
 * In-process app (no dependency on an external :3000 server).
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { FREE_CASE_LIMIT, ERROR_CODE_QUOTA, PRO_MONTHLY_PRICE_TOMAN } = require('../src/config/subscription');

let PORT = 0;
let server;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@legal.ir';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPass1';
const results = [];

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
          resolve({ status: res.statusCode, body: json });
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

async function createCase(token, i, status = 'active') {
  return req('POST', '/api/cases', {
    case_number: `T-${i}-${crypto.randomBytes(2).toString('hex')}`,
    title: `پرونده تست ${i}`,
    status
  }, auth(token));
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nSubscription TOTAL-cases quota tests → :${PORT}\n`);

  const suffix = Date.now();
  const email = `sub.lawyer.${suffix}@test.local`;
  const password = 'LawyerPass99';

  // Ensure admin exists for this in-process DB (seed may already have done so)
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

  const reg = await req('POST', '/api/register', {
    name: 'وکیل تست اشتراک',
    email,
    password,
    role: 'lawyer'
  });
  assert('register lawyer', reg.status === 200 || reg.status === 201, `status ${reg.status}`);
  let token = reg.body.accessToken || reg.body.token;
  const userId = reg.body.user.id;

  const adminLogin = await req('POST', '/api/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert('admin login', adminLogin.status === 200, `status ${adminLogin.status}`);
  const adminToken = adminLogin.body.accessToken || adminLogin.body.token;

  // Ensure FREE
  await req('PUT', `/api/admin/users/${userId}/subscription`, {
    plan: 'free'
  }, auth(adminToken));

  const sub0 = await req('GET', '/api/subscription', null, auth(token));
  assert('subscription FREE defaults', sub0.status === 200 && sub0.body.plan === 'free' && sub0.body.caseLimit === FREE_CASE_LIMIT);
  assert('PRO price from config', sub0.body.proMonthlyPriceToman === PRO_MONTHLY_PRICE_TOMAN);

  // Create 14 cases → 15th OK
  for (let i = 1; i <= 14; i++) {
    const r = await createCase(token, i, i % 2 === 0 ? 'closed' : 'active');
    if (r.status !== 200 && r.status !== 201) {
      assert(`create case ${i}`, false, `status ${r.status} ${r.body?.error}`);
      break;
    }
  }
  const c14 = await createCase(token, 15, 'active');
  assert('14 existing → 15th create OK', c14.status === 200 || c14.status === 201, `status ${c14.status}`);

  const blocked = await createCase(token, 16, 'active');
  assert(
    '15 cases → 16th blocked',
    blocked.status === 403 && blocked.body?.details?.code === ERROR_CODE_QUOTA,
    `status ${blocked.status} code ${blocked.body?.details?.code}`
  );

  // Mix active + archived still counts as 15
  const list = await req('GET', '/api/cases', null, auth(token));
  const cases = Array.isArray(list.body) ? list.body : (list.body?.items || []);
  assert('total cases is 15', cases.length === 15, `count ${cases.length}`);

  const firstId = cases[0].id;
  const arch = await req('PUT', `/api/cases/${firstId}`, { status: 'archived' }, auth(token));
  assert('archive case OK', arch.status === 200, `status ${arch.status}`);

  const stillBlocked = await createCase(token, 99, 'active');
  assert(
    'archive does NOT free quota',
    stillBlocked.status === 403 && stillBlocked.body?.details?.code === ERROR_CODE_QUOTA,
    `status ${stillBlocked.status}`
  );

  const subArch = await req('GET', '/api/subscription', null, auth(token));
  assert(
    'active+archived counted in totalCases',
    subArch.body.totalCases === 15,
    `totalCases ${subArch.body.totalCases}`
  );

  // Hard delete frees one slot (current policy = permanent delete)
  const del = await req('DELETE', `/api/cases/${firstId}`, null, auth(token));
  assert('hard delete OK', del.status === 200, `status ${del.status}`);
  const afterDel = await req('GET', '/api/subscription', null, auth(token));
  assert('hard delete reduces quota usage', afterDel.body.totalCases === 14, `totalCases ${afterDel.body.totalCases}`);
  const recreate = await createCase(token, 100, 'active');
  assert('after hard delete create OK', recreate.status === 200 || recreate.status === 201, `status ${recreate.status}`);

  // Back to 15 — block again
  const block2 = await createCase(token, 101, 'active');
  assert('back at 15 → blocked', block2.status === 403, `status ${block2.status}`);

  // PRO → unlimited
  const proSet = await req('PUT', `/api/admin/users/${userId}/subscription`, {
    plan: 'pro',
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
  }, auth(adminToken));
  assert('admin set PRO', proSet.status === 200 && proSet.body.plan === 'pro', `status ${proSet.status}`);

  const proCreate = await createCase(token, 200, 'active');
  assert('PRO unlimited create OK', proCreate.status === 200 || proCreate.status === 201, `status ${proCreate.status}`);

  const subPro = await req('GET', '/api/subscription', null, auth(token));
  assert('PRO caseLimit null', subPro.body.plan === 'pro' && subPro.body.caseLimit === null);
  const casesBeforeExpire = subPro.body.totalCases;

  // Expire PRO — cases remain, create blocked if >= 15
  const expire = await req('PUT', `/api/admin/users/${userId}/subscription`, {
    plan: 'pro',
    expiresAt: new Date(Date.now() - 3600000).toISOString()
  }, auth(adminToken));
  assert('set expired PRO', expire.status === 200);

  const subExp = await req('GET', '/api/subscription', null, auth(token));
  assert('expired PRO → effective FREE', subExp.body.plan === 'free' && subExp.body.isExpiredPro === true);
  assert(
    'expire does NOT delete cases',
    subExp.body.totalCases === casesBeforeExpire,
    `${subExp.body.totalCases} vs ${casesBeforeExpire}`
  );

  const listAfter = await req('GET', '/api/cases', null, auth(token));
  const casesAfter = Array.isArray(listAfter.body) ? listAfter.body : [];
  assert('cases still readable after expire', casesAfter.length === casesBeforeExpire, `count ${casesAfter.length}`);

  const blockedAfterExpire = await createCase(token, 300, 'active');
  assert(
    'expired PRO + total>=15 → create blocked',
    blockedAfterExpire.status === 403 && blockedAfterExpire.body?.details?.code === ERROR_CODE_QUOTA,
    `status ${blockedAfterExpire.status}`
  );

  // IDOR: other user cannot read/update this user's case
  const other = await req('POST', '/api/register', {
    name: 'وکیل دیگر',
    email: `other.${suffix}@test.local`,
    password: 'OtherPass99',
    role: 'lawyer'
  });
  const otherToken = other.body.accessToken || other.body.token;
  const victimCaseId = casesAfter[0]?.id;
  const idorGet = await req('GET', `/api/cases/${victimCaseId}`, null, auth(otherToken));
  assert('IDOR get → 404', idorGet.status === 404, `status ${idorGet.status}`);
  const idorPut = await req('PUT', `/api/cases/${victimCaseId}`, { title: 'hack' }, auth(otherToken));
  assert('IDOR put → 404', idorPut.status === 404, `status ${idorPut.status}`);
  const idorDel = await req('DELETE', `/api/cases/${victimCaseId}`, null, auth(otherToken));
  assert('IDOR delete → 404', idorDel.status === 404, `status ${idorDel.status}`);

  // Non-admin cannot set subscription
  const forbid = await req('PUT', `/api/admin/users/${userId}/subscription`, { plan: 'pro' }, auth(token));
  assert('non-admin subscription → 403', forbid.status === 403, `status ${forbid.status}`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${passed} passed / ${failed} failed / ${results.length} total ===\n`);

  // Cleanup test users' cases (best-effort)
  try {
    await db('cases').whereIn('owner_id', [userId, other.body.user.id]).del();
    await db('users').whereIn('id', [userId, other.body.user.id]).del();
  } catch { /* ignore */ }
  await new Promise((r) => server.close(r));
  await db.destroy();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    if (server) await new Promise((r) => server.close(r));
    await db.destroy();
  } catch { /* ignore */ }
  process.exit(1);
});
