/**
 * MFA login flow — no accessToken before verify; challenge/setup edge cases.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY
  || 'test-backup-encryption-key-32chars!!';
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY
  || process.env.BACKUP_ENCRYPTION_KEY;
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { resetRateLimitStoreForTests, MemoryRateLimitStore } = require('../src/middleware/rateLimitStore');
resetRateLimitStoreForTests(new MemoryRateLimitStore());

const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const config = require('../src/config');
const { totp } = require('../src/utils/totp');

const results = [];
let PORT = 0;
let server;

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method,
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

const authH = (token) => ({ Authorization: 'Bearer ' + token });

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nMFA login flow tests → :${PORT}\n`);

  const lawyerEmail = `lawyer.mfa.${Date.now()}@mfa.test`;
  const lawyerPass = 'LawyerMfaPass99';
  const reg = await req('POST', '/api/register', {
    name: 'Lawyer',
    email: lawyerEmail,
    password: lawyerPass,
    role: 'lawyer'
  });
  assert('login معمولی بدون MFA: register', reg.status === 200 || reg.status === 201, `status ${reg.status}`);
  assert('login معمولی بدون MFA: accessToken', !!(reg.body && reg.body.accessToken));
  assert('login معمولی بدون MFA: refreshToken', !!(reg.body && reg.body.refreshToken));

  const lawyerLogin = await req('POST', '/api/login', { email: lawyerEmail, password: lawyerPass });
  assert(
    'login معمولی بدون MFA: login response',
    lawyerLogin.status === 200 && !!lawyerLogin.body.accessToken && !lawyerLogin.body.mfaRequired,
    `status ${lawyerLogin.status}`
  );

  const adminEmail = `admin.flow.${Date.now()}@mfa.test`;
  const adminPass = 'AdminFlowPass99!';
  const [adminId] = await db('users').insert({
    name: 'Admin Flow',
    email: adminEmail,
    password_hash: await bcrypt.hash(adminPass, 12),
    role: 'admin',
    token_version: 0,
    must_change_password: false,
    mfa_enabled: false,
    created_at: db.fn.now()
  });

  const adminPlain = await req('POST', '/api/login', { email: adminEmail, password: adminPass });
  assert(
    'admin بدون MFA در dev: accessToken',
    adminPlain.status === 200 && !!adminPlain.body.accessToken && !adminPlain.body.mfaRequired,
    `status ${adminPlain.status}`
  );
  const adminToken = adminPlain.body.accessToken;

  const setup = await req('POST', '/api/mfa/setup', null, authH(adminToken));
  assert('mfa setup', setup.status === 200 && setup.body && setup.body.secret);
  const secret = setup.body.secret;
  const recoveryCodes = setup.body.recoveryCodes || [];
  assert('recovery codes issued', recoveryCodes.length >= 8);

  const enable = await req('POST', '/api/mfa/enable', { code: totp(secret) }, authH(adminToken));
  assert('mfa enable', enable.status === 200 && enable.body && enable.body.mfa_enabled === true);

  const mfaLogin = await req('POST', '/api/login', { email: adminEmail, password: adminPass });
  assert(
    'login admin با MFA: mfaRequired',
    mfaLogin.status === 200 && mfaLogin.body.mfaRequired === true && !!mfaLogin.body.mfaToken,
    `status ${mfaLogin.status}`
  );
  assert(
    'عدم دریافت accessToken قبل از MFA verify',
    !mfaLogin.body.accessToken && !mfaLogin.body.token && !mfaLogin.body.refreshToken,
    JSON.stringify({
      accessToken: mfaLogin.body.accessToken || null,
      refreshToken: mfaLogin.body.refreshToken || null
    })
  );

  const noToken = await req('POST', '/api/mfa/verify', { code: totp(secret) });
  assert('تلاش بدون mfaToken', noToken.status === 400 || noToken.status === 401, `status ${noToken.status}`);

  const fakeToken = await req('POST', '/api/mfa/verify', {
    mfaToken: 'not.a.real.jwt',
    code: totp(secret)
  });
  assert('mfaToken جعلی', fakeToken.status === 401, `status ${fakeToken.status}`);

  const expired = jwt.sign(
    { id: adminId, typ: 'mfa_challenge', tv: 0 },
    config.jwt.accessSecret,
    { expiresIn: -10 }
  );
  const expiredRes = await req('POST', '/api/mfa/verify', {
    mfaToken: expired,
    code: totp(secret)
  });
  assert('mfaToken منقضی', expiredRes.status === 401, `status ${expiredRes.status}`);

  const badCode = await req('POST', '/api/mfa/verify', {
    mfaToken: mfaLogin.body.mfaToken,
    code: '000000'
  });
  assert('MFA code غلط', badCode.status === 401, `status ${badCode.status}`);

  await db('users').where({ id: adminId }).update({ mfa_failed_attempts: 0, mfa_locked_until: null });

  const challenge2 = await req('POST', '/api/login', { email: adminEmail, password: adminPass });
  assert('challenge تازه برای کد صحیح', !!(challenge2.body && challenge2.body.mfaToken));
  const okCode = await req('POST', '/api/mfa/verify', {
    mfaToken: challenge2.body.mfaToken,
    code: totp(secret)
  });
  assert(
    'MFA code صحیح',
    okCode.status === 200 && !!okCode.body.accessToken && !!okCode.body.refreshToken,
    `status ${okCode.status}`
  );

  const refresh = await req('POST', '/api/refresh', { refreshToken: okCode.body.refreshToken });
  assert('refresh بعد از MFA login', refresh.status === 200 && !!refresh.body.accessToken, `status ${refresh.status}`);

  const logout = await req('POST', '/api/logout', {
    refreshToken: refresh.body.refreshToken || okCode.body.refreshToken
  }, authH(okCode.body.accessToken));
  assert('logout بعد از MFA login', logout.status === 200 || logout.status === 204 || logout.status === 200, `status ${logout.status}`);

  await db('users').where({ id: adminId }).update({ mfa_failed_attempts: 0, mfa_locked_until: null });
  const challenge3 = await req('POST', '/api/login', { email: adminEmail, password: adminPass });
  const recovery = recoveryCodes[0];
  const viaRec = await req('POST', '/api/mfa/verify', {
    mfaToken: challenge3.body.mfaToken,
    code: recovery
  });
  assert('recovery code صحیح', viaRec.status === 200 && !!viaRec.body.accessToken, `status ${viaRec.status}`);

  await db('users').where({ id: adminId }).update({ mfa_failed_attempts: 0, mfa_locked_until: null });
  const challenge4 = await req('POST', '/api/login', { email: adminEmail, password: adminPass });
  const reused = await req('POST', '/api/mfa/verify', {
    mfaToken: challenge4.body.mfaToken,
    code: recovery
  });
  assert('recovery code مصرف‌شده', reused.status === 401, `status ${reused.status}`);

  // UI contract: admin.html / index.html must not persist empty tokens (static check)
  const fs = require('fs');
  const path = require('path');
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert('admin.html: pendingMfaToken memory-only', adminHtml.includes('pendingMfaToken') && !/localStorage\.setItem\([^)]*mfaToken/i.test(adminHtml));
  assert('index.html: pendingMfaToken memory-only', indexHtml.includes('pendingMfaToken') && !/localStorage\.setItem\([^)]*mfaToken/i.test(indexHtml));
  assert('admin.html: gates mfaRequired before persist', adminHtml.includes('mfaRequired') && adminHtml.includes('persistAdmin'));
  assert('index.html: gates mfaRequired before persist', indexHtml.includes('mfaRequired') && indexHtml.includes('persistAuth'));
  assert('persistAdmin rejects empty access', /if\s*\(\s*!access\s*\)\s*return\s+false/.test(adminHtml));
  assert('persistAuth rejects empty access', /if\s*\(\s*!access\s*\)\s*return\s+false/.test(indexHtml));

  try {
    await db('mfa_recovery_codes').where({ user_id: adminId }).del();
    await db('refresh_tokens').where({ user_id: adminId }).del();
    await db('users').where({ id: adminId }).del();
    await db('refresh_tokens').where({ user_id: reg.body.user.id }).del();
    await db('users').where({ id: reg.body.user.id }).del();
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
  try {
    if (server) await new Promise((r) => server.close(r));
    await db.destroy();
  } catch { /* ignore */ }
  process.exit(1);
});
