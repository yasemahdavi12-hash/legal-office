/**
 * Password-reset OTP integration tests (in-process).
 * Uses OTP_TEST_FIXED for deterministic OTP in non-production.
 */
require('dotenv').config();
process.env.OTP_TEST_FIXED = process.env.OTP_TEST_FIXED || '123456';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const http = require('http');
const bcrypt = require('bcryptjs');
const { resetRateLimitStoreForTests, MemoryRateLimitStore } = require('../src/middleware/rateLimitStore');
resetRateLimitStoreForTests(new MemoryRateLimitStore());

const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { toDbDateTime } = require('../src/utils/dbHelpers');

const OTP = process.env.OTP_TEST_FIXED;
const results = [];
let PORT = 0;
let server;

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
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
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nOTP reset tests → :${PORT}\n`);

  const email = `reset.user.${Date.now()}@test.local`;
  const password = 'ResetUserPass99';
  const [uid] = await db('users').insert({
    name: 'Reset User',
    email,
    password_hash: await bcrypt.hash(password, 12),
    role: 'lawyer',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });
  const userId = uid || (await db('users').where({ email }).first()).id;

  // 1) Enumeration-safe forgot (existing vs missing)
  const a = await req('POST', '/api/auth/forgot-password', { email });
  const b = await req('POST', '/api/auth/forgot-password', { email: 'nobody-xyz-' + Date.now() + '@example.com' });
  assert(
    'enumeration-safe response (existing vs missing)',
    a.status === 200 && b.status === 200 && a.body.message === b.body.message,
    `status ${a.status}/${b.status}`
  );

  // Fresh OTP for valid flow
  await req('POST', '/api/auth/forgot-password', { email });

  // 2) Wrong OTP
  const wrong = await req('POST', '/api/auth/verify-otp', { email, otp: '000000' });
  assert('OTP اشتباه → 400', wrong.status === 400, `status ${wrong.status}`);

  // 3) Valid OTP
  await req('POST', '/api/auth/forgot-password', { email });
  const good = await req('POST', '/api/auth/verify-otp', { email, otp: OTP });
  assert(
    'OTP معتبر → resetToken',
    good.status === 200 && typeof good.body.resetToken === 'string' && good.body.resetToken.length >= 32,
    `status ${good.status}`
  );
  const resetToken = good.body.resetToken;

  // 4) Reused OTP
  const reuse = await req('POST', '/api/auth/verify-otp', { email, otp: OTP });
  assert('OTP دوباره استفاده‌شده → 400', reuse.status === 400, `status ${reuse.status}`);

  // 5) Invalid reset session
  const badReset = await req('POST', '/api/auth/reset-password', {
    resetToken: 'a'.repeat(64),
    password: 'NewSecurePass99'
  });
  assert('invalid reset session → 400', badReset.status === 400, `status ${badReset.status}`);

  // 6) Login + refresh, then reset password, then refresh revoked
  const login1 = await req('POST', '/api/login', { email, password });
  assert('login قبل از reset', login1.status === 200 && !!login1.body.refreshToken, `status ${login1.status}`);
  const oldRefresh = login1.body.refreshToken;

  const newPass = 'ResetPassAfterOtp99';
  const resetOk = await req('POST', '/api/auth/reset-password', {
    resetToken,
    password: newPass
  });
  assert('reset password موفق', resetOk.status === 200 && resetOk.body.ok === true, `status ${resetOk.status}`);

  const refreshAfter = await req('POST', '/api/refresh', { refreshToken: oldRefresh });
  assert(
    'revoke refresh tokens بعد از reset',
    refreshAfter.status === 401 || refreshAfter.status === 403 || refreshAfter.status === 400,
    `status ${refreshAfter.status}`
  );

  const loginOld = await req('POST', '/api/login', { email, password });
  assert('رمز قبلی دیگر کار نمی‌کند', loginOld.status === 401 || loginOld.status === 400, `status ${loginOld.status}`);

  const loginNew = await req('POST', '/api/login', { email, password: newPass });
  assert('login با رمز جدید', loginNew.status === 200, `status ${loginNew.status}`);

  // 7) Expired OTP
  await req('POST', '/api/auth/forgot-password', { email });
  const row = await db('password_otps')
    .where({ identifier_norm: email.toLowerCase(), consumed_at: null })
    .orderBy('id', 'desc')
    .first();
  if (row) {
    await db('password_otps').where({ id: row.id }).update({
      expires_at: toDbDateTime(new Date(Date.now() - 60_000))
    });
  }
  const expired = await req('POST', '/api/auth/verify-otp', { email, otp: OTP });
  assert('OTP منقضی → 400', expired.status === 400, `status ${expired.status}`);

  // 8) Rate limit on forgot-password (max 8)
  let limited = null;
  for (let i = 0; i < 12; i++) {
    limited = await req('POST', '/api/auth/forgot-password', { email: 'rate-' + i + '@example.com' });
    if (limited.status === 429) break;
  }
  assert('rate limit forgot-password → 429', limited && limited.status === 429, `status ${limited && limited.status}`);

  // Reused reset token
  const reusedSession = await req('POST', '/api/auth/reset-password', {
    resetToken,
    password: 'AnotherPass1234'
  });
  assert('reset session یک‌بارمصرف → 400', reusedSession.status === 400, `status ${reusedSession.status}`);

  try {
    await db('password_reset_sessions').where({ user_id: userId }).del();
    await db('password_otps').where({ user_id: userId }).del();
    await db('refresh_tokens').where({ user_id: userId }).del();
    await db('users').where({ id: userId }).del();
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
