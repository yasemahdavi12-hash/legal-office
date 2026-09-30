/**
 * Security hardening suite — MFA, token family, encrypted backup, soft-delete,
 * audit coverage, rate-limit store, headers/IDOR/payment regressions.
 * No skipped assertions.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const bcrypt = require('bcryptjs');

process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY
  || 'test-backup-encryption-key-32chars!!';
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY
  || process.env.BACKUP_ENCRYPTION_KEY;
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}

const { resetRateLimitStoreForTests, MemoryRateLimitStore } = require('../src/middleware/rateLimitStore');
resetRateLimitStoreForTests(new MemoryRateLimitStore());

const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { setPaymentProvider } = require('../src/services/payment');
const mfaService = require('../src/services/mfa.service');
const { encryptBufferToFileParts, decryptFileParts } = require('../src/utils/cryptoBox');
const { LocalBackupStorage } = require('../src/services/backup/storage');
const { safeLog } = require('../src/utils/logger');
const { verifyTotp, totp } = require('../src/utils/totp');

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
        resolve({ status: res.statusCode, headers: res.headers, body: json, text: raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const authH = (token) => ({ Authorization: 'Bearer ' + token });

async function registerLawyer(prefix) {
  const email = `${prefix}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}@hard.test`;
  const r = await req('POST', '/api/register', {
    name: prefix,
    email,
    password: 'HardTestPass99',
    role: 'lawyer'
  });
  return {
    email,
    token: r.body && (r.body.accessToken || r.body.token),
    refresh: r.body && r.body.refreshToken,
    user: r.body && r.body.user,
    status: r.status
  };
}

async function ensureAdmin() {
  const email = `admin.mfa.${Date.now()}@hard.test`;
  const password = 'AdminMfaPass99!';
  const [id] = await db('users').insert({
    name: 'MFA Admin',
    email,
    password_hash: await bcrypt.hash(password, 12),
    role: 'admin',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });
  return { id: id || (await db('users').where({ email }).first()).id, email, password };
}

async function main() {
  await db.migrate.latest();
  setPaymentProvider({
    async requestPayment() {
      const authority = ('A' + crypto.randomBytes(16).toString('hex')).slice(0, 36);
      return { authority, paymentUrl: 'https://sandbox.zarinpal.com/pg/StartPay/' + authority, rawCode: 100 };
    },
    async verifyPayment() {
      return { ok: true, refId: 1, code: 100, message: 'Verified' };
    }
  });

  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nSecurity hardening → :${PORT}\n`);

  // --- Headers / CORS (prod-like already covered; smoke) ---
  const health = await req('GET', '/api/health');
  assert('headers nosniff', /nosniff/i.test(health.headers['x-content-type-options'] || ''));
  assert('headers frame deny', /DENY|SAMEORIGIN/i.test(health.headers['x-frame-options'] || ''));
  assert('headers permissions-policy', !!(health.headers['permissions-policy']));

  // --- AES-256-GCM unit ---
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  const { iv, tag, ciphertext } = encryptBufferToFileParts(Buffer.from('secret-backup'), key);
  const plain = decryptFileParts({ iv, tag, ciphertext }, key).toString('utf8');
  assert('AES-256-GCM roundtrip', plain === 'secret-backup');

  // --- Local backup storage abstraction ---
  const tmpStore = path.join(__dirname, '..', 'backups', 'test-remote-' + Date.now());
  const storage = new LocalBackupStorage(tmpStore);
  await storage.putObject('a/b.enc', Buffer.from('abc'));
  const got = await storage.getObject('a/b.enc');
  assert('backup local storage put/get', got.toString() === 'abc');
  fs.rmSync(tmpStore, { recursive: true, force: true });

  // --- TOTP helpers ---
  const secret = 'JBSWY3DPEHPK3PXP'; // known test secret
  assert('totp verify window', verifyTotp(secret, totp(secret)));

  // --- MFA for admin ---
  const admin = await ensureAdmin();
  let login = await req('POST', '/api/login', { email: admin.email, password: admin.password });
  assert('admin login without MFA issues tokens', login.status === 200 && !!(login.body && login.body.accessToken));
  let adminToken = login.body.accessToken;

  const setup = await req('POST', '/api/mfa/setup', null, authH(adminToken));
  assert('mfa setup', setup.status === 200 && setup.body && setup.body.secret && Array.isArray(setup.body.recoveryCodes));
  const mfaSecret = setup.body.secret;
  const recoveryCodes = setup.body.recoveryCodes;
  assert('mfa recovery codes count', recoveryCodes.length >= 8);

  const enable = await req('POST', '/api/mfa/enable', { code: totp(mfaSecret) }, authH(adminToken));
  assert('mfa enable', enable.status === 200 && enable.body && enable.body.mfa_enabled === true);

  login = await req('POST', '/api/login', { email: admin.email, password: admin.password });
  assert('admin login requires MFA', login.status === 200 && login.body && login.body.mfaRequired === true && !!login.body.mfaToken);

  const badMfa = await req('POST', '/api/mfa/verify', { mfaToken: login.body.mfaToken, code: '000000' });
  assert('mfa bad code rejected', badMfa.status === 401);

  // brute-force lock (5 fails)
  for (let i = 0; i < 5; i += 1) {
    await req('POST', '/api/mfa/verify', { mfaToken: login.body.mfaToken, code: '111111' });
  }
  const locked = await req('POST', '/api/mfa/verify', { mfaToken: login.body.mfaToken, code: totp(mfaSecret) });
  assert('mfa brute-force lock', locked.status === 429 || locked.status === 401, `status=${locked.status}`);

  // unlock for further tests
  await db('users').where({ id: admin.id }).update({ mfa_failed_attempts: 0, mfa_locked_until: null });
  login = await req('POST', '/api/login', { email: admin.email, password: admin.password });
  const okMfa = await req('POST', '/api/mfa/verify', {
    mfaToken: login.body.mfaToken,
    code: totp(mfaSecret)
  });
  assert('mfa verify success', okMfa.status === 200 && !!(okMfa.body && okMfa.body.accessToken));
  adminToken = okMfa.body.accessToken;

  // recovery code path
  await db('users').where({ id: admin.id }).update({ mfa_failed_attempts: 0, mfa_locked_until: null });
  login = await req('POST', '/api/login', { email: admin.email, password: admin.password });
  const viaRecovery = await req('POST', '/api/mfa/verify', {
    mfaToken: login.body.mfaToken,
    code: recoveryCodes[0]
  });
  assert('mfa recovery code login', viaRecovery.status === 200 && !!(viaRecovery.body && viaRecovery.body.accessToken));

  const mfaAudit = await db('audit_logs').where({ entity_type: 'mfa' }).first();
  assert('audit log MFA events', !!mfaAudit);

  // --- Refresh family revoke on reuse ---
  const lawyer = await registerLawyer('fam');
  assert('lawyer register', lawyer.status === 201 && !!lawyer.refresh);
  const r1 = await req('POST', '/api/refresh', { refreshToken: lawyer.refresh });
  assert('refresh rotation ok', r1.status === 200 && !!r1.body.refreshToken);
  const reuse = await req('POST', '/api/refresh', { refreshToken: lawyer.refresh });
  assert('refresh reuse rejected', reuse.status === 401);
  const reuseAudit = await db('audit_logs').where({ action: 'REFRESH_REUSE' }).first();
  assert('audit refresh reuse', !!reuseAudit);
  // new token from rotation should also be invalid after family revoke
  const afterReuse = await req('POST', '/api/refresh', { refreshToken: r1.body.refreshToken });
  assert('family revoked after reuse', afterReuse.status === 401, `status=${afterReuse.status}`);
  const accessDead = await req('GET', '/api/cases', null, authH(lawyer.token));
  assert('access token family invalidated', accessDead.status === 401, `status=${accessDead.status}`);

  // --- Document soft delete + private storage ---
  const a = await registerLawyer('doc');
  const caseA = await req('POST', '/api/cases', {
    case_number: 'H-1',
    title: 'پرونده سخت‌سازی',
    status: 'active'
  }, authH(a.token));
  assert('case create', caseA.status === 201);
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './storage/uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const stored = `hard-${Date.now()}.png`;
  // 1x1 png
  fs.writeFileSync(path.join(uploadDir, stored), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  ));
  const [docId] = await db('documents').insert({
    case_id: caseA.body.id,
    owner_id: a.user.id,
    file_name: 'x.png',
    stored_name: stored,
    file_path: stored,
    file_type: 'image/png',
    category: 'other',
    file_size: 68,
    uploaded_at: db.fn.now()
  });
  const soft = await req('DELETE', `/api/documents/${docId}`, null, authH(a.token));
  assert('document soft delete', soft.status === 200 && soft.body && soft.body.soft === true);
  const gone = await req('GET', `/api/documents/${docId}/download`, null, authH(a.token));
  assert('soft-deleted download 404', gone.status === 404);
  assert('soft-delete keeps file on disk', fs.existsSync(path.join(uploadDir, stored)));
  const perm = await req('DELETE', `/api/documents/${docId}?permanent=true`, null, authH(a.token));
  assert('document permanent delete', perm.status === 200 && perm.body && perm.body.permanent === true);
  assert('permanent delete removes file', !fs.existsSync(path.join(uploadDir, stored)));
  const blocked = await req('GET', `/storage/uploads/${stored}`);
  assert('storage not public', blocked.status === 404);

  // --- IDOR smoke ---
  const b = await registerLawyer('bob');
  const idor = await req('GET', `/api/cases/${caseA.body.id}`, null, authH(b.token));
  assert('case IDOR → 404', idor.status === 404);

  // --- Payment manipulation ---
  const pay = await req('POST', '/api/subscription/checkout', { amount: 1 }, authH(a.token));
  assert('payment amount manipulation rejected', pay.status === 400);

  // --- Push IDOR ---
  const endpoint = `https://push.example/hard/${Date.now()}`;
  await req('POST', '/api/push/subscribe', {
    endpoint,
    keys: { p256dh: 'B'.repeat(87), auth: crypto.randomBytes(16).toString('base64url') }
  }, authH(a.token));
  const pushIdor = await req('POST', '/api/push/subscribe', {
    endpoint,
    keys: { p256dh: 'C'.repeat(87), auth: crypto.randomBytes(16).toString('base64url') }
  }, authH(b.token));
  assert('push IDOR blocked', pushIdor.status === 403);

  // --- Audit: login ---
  const loginAudit = await db('audit_logs').where({ action: 'LOGIN_OK' }).first();
  assert('audit login events', !!loginAudit);

  // --- safeLog redaction ---
  const logs = [];
  const orig = console.error;
  console.error = (...args) => { logs.push(args); };
  safeLog({ password: 'x', mfaToken: 'y', recoveryCodes: ['a'], otp: '123456' });
  console.error = orig;
  const dumped = JSON.stringify(logs);
  assert('safeLog redacts secrets', !dumped.includes('"x"') && dumped.includes('[REDACTED]'));

  // --- Profile + change password ---
  const me = await req('GET', '/api/me', null, authH(a.token));
  assert('GET /me profile', me.status === 200 && me.body && me.body.email === a.email);
  const patched = await req('PATCH', '/api/me', {
    name: 'Alice Updated',
    phone: '09120000000',
    license_number: 'PRO-12345'
  }, authH(a.token));
  assert(
    'PATCH /me profile',
    patched.status === 200 && patched.body && patched.body.name === 'Alice Updated'
      && patched.body.license_number === 'PRO-12345',
    `status ${patched.status}`
  );
  const me2 = await req('GET', '/api/me', null, authH(a.token));
  assert('license persisted for owner', me2.body && me2.body.license_number === 'PRO-12345');
  const otherMe = await req('GET', '/api/me', null, authH(b.token));
  assert(
    'license IDOR: other user does not see alice license',
    otherMe.status === 200 && otherMe.body && otherMe.body.license_number !== 'PRO-12345'
  );
  const badPw = await req('POST', '/api/change-password', {
    currentPassword: 'wrong-pass',
    newPassword: 'NewHardPass99'
  }, authH(a.token));
  assert('change-password rejects wrong current', badPw.status === 401);
  const okPw = await req('POST', '/api/change-password', {
    currentPassword: 'HardTestPass99',
    newPassword: 'NewHardPass99'
  }, authH(a.token));
  assert('change-password success', okPw.status === 200 && okPw.body && okPw.body.ok === true);
  const relogin = await req('POST', '/api/login', { email: a.email, password: 'NewHardPass99' });
  assert('login with new password', relogin.status === 200 && !!relogin.body.accessToken);
  const badRole = await req('POST', '/api/register', {
    name: 'Secretary Attempt',
    email: `sec.${Date.now()}@hard.test`,
    password: 'HardTestPass99',
    role: 'secretary'
  });
  assert('register secretary rejected', badRole.status === 400);

  // --- Rate limit store memory incr ---
  const store = new MemoryRateLimitStore();
  const i1 = await store.incr('t', 60000);
  const i2 = await store.incr('t', 60000);
  assert('memory rate limit incr', i1.count === 1 && i2.count === 2);

  // cleanup
  await db('documents').where({ owner_id: a.user.id }).del();
  await db('cases').whereIn('owner_id', [a.user.id, b.user.id, lawyer.user.id]).del();
  await db('refresh_tokens').whereIn('user_id', [a.user.id, b.user.id, lawyer.user.id, admin.id]).del();
  await db('mfa_recovery_codes').where({ user_id: admin.id }).del();
  await db('users').whereIn('id', [a.user.id, b.user.id, lawyer.user.id, admin.id]).del();

  server.close();
  await db.destroy();

  const failed = results.filter((x) => !x.ok);
  console.log(`\n=== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total ===\n`);
  if (failed.length) {
    failed.forEach((f) => console.log('FAIL detail:', f.name, f.detail));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
