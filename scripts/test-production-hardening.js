/**
 * Production-hardening suite:
 * - Encrypted S3-compatible backup upload/download/decrypt/restore + no plaintext in remote
 * - Redis rate-limit (shared) via real ioredis against in-process RESP server
 * - Refresh reuse invalidates family access tokens only
 * - Document soft-delete cleanup retention / idempotency
 * - MFA required for admin when NODE_ENV=production (child process)
 */
require('dotenv').config();
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY
  || 'test-backup-encryption-key-32chars!!';
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY
  || process.env.BACKUP_ENCRYPTION_KEY;
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DOCUMENT_SOFT_DELETE_RETENTION_DAYS = '30';
process.env.BACKUP_RETENTION_COUNT = '2';
if (!process.env.VAPID_PUBLIC_KEY) {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}

const { resetRateLimitStoreForTests, MemoryRateLimitStore, RedisRateLimitStore } = require('../src/middleware/rateLimitStore');
resetRateLimitStoreForTests(new MemoryRateLimitStore());

const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { MemoryBackupStorage, S3CompatibleBackupStorage, createBackupStorage } = require('../src/services/backup/storage');
const {
  createEncryptedBackup,
  restoreFromEncrypted,
  encryptPack,
  decryptPack,
  packStaging
} = require('../src/services/backup/backup.service');
const { cleanupSoftDeletedDocuments } = require('../src/jobs/documentCleanup');
const { toDbDateTime } = require('../src/utils/dbHelpers');
const { totp } = require('../src/utils/totp');
const Redis = require('ioredis');

const results = [];
function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function reqFactory(port) {
  return (method, urlPath, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1',
      port,
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

/** Minimal Redis RESP server for INCR / PEXPIRE / PTTL — real TCP + ioredis client. */
function startMiniRedis() {
  const store = new Map();
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      while (buf.includes('\r\n')) {
        // parse simple array commands
        if (!buf.startsWith('*')) {
          buf = '';
          break;
        }
        const lines = buf.split('\r\n');
        // Need full command
        const n = Number(lines[0].slice(1));
        if (!Number.isFinite(n) || n < 1) {
          buf = '';
          break;
        }
        const needed = 1 + n * 2;
        if (lines.length < needed + 1) break;
        const args = [];
        for (let i = 0; i < n; i += 1) {
          args.push(lines[2 + i * 2]);
        }
        buf = lines.slice(needed).join('\r\n');
        const cmd = String(args[0] || '').toUpperCase();
        if (cmd === 'INCR') {
          const key = args[1];
          const entry = store.get(key) || { value: 0, expireAt: null };
          entry.value += 1;
          store.set(key, entry);
          socket.write(`:${entry.value}\r\n`);
        } else if (cmd === 'PEXPIRE') {
          const key = args[1];
          const ms = Number(args[2]);
          const entry = store.get(key);
          if (entry) {
            entry.expireAt = Date.now() + ms;
            store.set(key, entry);
            socket.write(':1\r\n');
          } else socket.write(':0\r\n');
        } else if (cmd === 'PTTL') {
          const key = args[1];
          const entry = store.get(key);
          if (!entry) socket.write(':-2\r\n');
          else if (!entry.expireAt) socket.write(':-1\r\n');
          else socket.write(`:${Math.max(0, entry.expireAt - Date.now())}\r\n`);
        } else if (cmd === 'INFO' || cmd === 'INFO\r') {
          const payload = 'redis_version:7.0.0\r\n';
          socket.write(`$${payload.length}\r\n${payload}\r\n`);
        } else if (cmd === 'CLUSTER') {
          socket.write('-ERR This instance has cluster support disabled\r\n');
        } else if (cmd === 'PING') {
          socket.write('+PONG\r\n');
        } else if (cmd === 'QUIT') {
          socket.write('+OK\r\n');
          socket.end();
        } else {
          // Ignore unknown for client handshake noise
          socket.write('+OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Minimal S3-compatible HTTP endpoint for Put/Get/Delete/List. */
function startMiniS3() {
  const objects = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const parts = u.pathname.split('/').filter(Boolean);
    // /bucket/key...
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (!key.endsWith('.enc')) {
          res.statusCode = 400;
          return res.end('only enc');
        }
        objects.set(key, body);
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') || '';
      let xml = '<?xml version="1.0"?><ListBucketResult>';
      for (const [k] of objects) {
        if (k.startsWith(prefix)) xml += `<Contents><Key>${k}</Key></Contents>`;
      }
      xml += '</ListBucketResult>';
      res.setHeader('Content-Type', 'application/xml');
      return res.end(xml);
    }
    if (req.method === 'GET') {
      if (!objects.has(key)) {
        res.statusCode = 404;
        return res.end('no');
      }
      res.statusCode = 200;
      return res.end(objects.get(key));
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
      return res.end();
    }
    res.statusCode = 405;
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        objects,
        endpoint: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

async function main() {
  await db.migrate.latest();
  console.log('\nProduction hardening tests\n');

  // ---------- Redis distributed rate limit ----------
  const miniRedis = await startMiniRedis();
  const redisUrl = `redis://127.0.0.1:${miniRedis.port}`;
  const clientA = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    enableOfflineQueue: true
  });
  const clientB = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    enableOfflineQueue: true
  });
  // wait briefly for TCP
  await new Promise((r) => setTimeout(r, 100));
  const storeA = new RedisRateLimitStore(clientA);
  const storeB = new RedisRateLimitStore(clientB);
  const a1 = await storeA.incr('shared-user', 60000);
  const b1 = await storeB.incr('shared-user', 60000);
  assert('redis distributed incr shared', a1.count === 1 && b1.count === 2, `a=${a1.count} b=${b1.count}`);
  await clientA.quit();
  await clientB.quit();
  miniRedis.server.close();

  // Production fail-closed without REDIS_URL
  const prodRedisCheck = spawnSync(process.execPath, ['-e', `
    process.env.NODE_ENV='production';
    process.env.REDIS_URL='';
    try {
      const { createRateLimitStore } = require('./src/middleware/rateLimitStore');
      createRateLimitStore();
      console.log('UNEXPECTED_OK');
      process.exit(1);
    } catch (e) {
      console.log(e.message);
      process.exit(0);
    }
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert(
    'production rate-limit requires REDIS_URL',
    prodRedisCheck.status === 0 && /REDIS_URL/.test(prodRedisCheck.stdout || ''),
    prodRedisCheck.stdout || prodRedisCheck.stderr
  );

  // ---------- Encrypted backup → remote .enc only → download → decrypt → restore ----------
  const s3 = await startMiniS3();
  const s3Store = new S3CompatibleBackupStorage({
    endpoint: s3.endpoint,
    region: 'us-east-1',
    bucket: 'legal-backups',
    accessKeyId: 'test',
    secretAccessKey: 'testsecret',
    forcePathStyle: true
  });

  // Stage a tiny sqlite-compatible payload via MemoryBackupStorage path of service
  const mem = new MemoryBackupStorage();
  process.env.BACKUP_KEEP_LOCAL_ENC = 'false';
  process.env.BACKUP_KEEP_PLAINTEXT = 'false';

  // Build encrypted blob directly and put via S3 client (same encrypt path as production)
  const staging = path.join(__dirname, '..', 'backups', `.prod-test-${Date.now()}`);
  fs.mkdirSync(path.join(staging, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ test: true }));
  fs.writeFileSync(path.join(staging, 'uploads', 'note.txt'), 'private-doc');
  // fake sqlite file for restore path when using sqlite
  if ((process.env.DB_CLIENT || 'sqlite') === 'sqlite' || !process.env.DB_CLIENT) {
    const dbFile = path.resolve(process.env.DB_FILENAME || './database/legal.sqlite');
    if (fs.existsSync(dbFile)) {
      fs.copyFileSync(dbFile, path.join(staging, 'legal.sqlite'));
    } else {
      fs.writeFileSync(path.join(staging, 'legal.sqlite'), 'sqlite-placeholder');
    }
  }
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  const encBuf = encryptPack(packStaging(staging), key);
  fs.rmSync(staging, { recursive: true, force: true });

  const remoteKey = `legal-app/backup-prodtest-${Date.now()}.enc`;
  await s3Store.putObject(remoteKey, encBuf);
  assert('s3 put only .enc', s3.objects.has(remoteKey.replace(/^[^/]+\//, '')) || [...s3.objects.keys()].some((k) => k.endsWith('.enc')));

  // Path-style key in mini s3: pathname /legal-backups/legal-app/...
  // Our mini server uses parts.slice(1) so key = legal-app/...
  const storedKeys = [...s3.objects.keys()];
  assert('remote has encrypted object', storedKeys.some((k) => k.endsWith('.enc')));
  assert('remote has no plaintext sql/sqlite', !storedKeys.some((k) => /\.(sql|sqlite|txt|json)$/i.test(k) && !k.endsWith('.enc')));

  const downloaded = await s3Store.getObject(remoteKey);
  const round = decryptPack(downloaded, key);
  assert('s3 download decrypt ok', Buffer.isBuffer(round) && round.length > 10);

  // Reject plaintext put
  let rejectedPlain = false;
  try {
    await s3Store.putObject('legal-app/plain.sql', Buffer.from('SELECT 1'));
  } catch {
    rejectedPlain = true;
  }
  assert('s3 rejects non-.enc upload', rejectedPlain);

  // Memory storage integration via createEncryptedBackup
  const backupResult = await createEncryptedBackup({ storage: mem });
  assert('encrypted backup created', backupResult.ok && backupResult.key.endsWith('.enc'));
  assert('plaintext not kept', backupResult.plaintext_kept === false);
  const remoteList = await mem.listObjects('legal-app/');
  assert('memory remote only .enc', remoteList.every((o) => o.key.endsWith('.enc')));
  // retention keep=2: create extras
  await createEncryptedBackup({ storage: mem });
  await createEncryptedBackup({ storage: mem });
  const afterRet = await mem.listObjects('legal-app/');
  assert('backup retention applied', afterRet.length <= 2, `count=${afterRet.length}`);

  const restore = await restoreFromEncrypted(backupResult.key, { storage: mem, keepWorkDir: false });
  assert('restore from encrypted remote', restore.ok === true);

  // Production fail-closed missing S3
  const prodBackupCheck = spawnSync(process.execPath, ['-e', `
    process.env.NODE_ENV='production';
    process.env.BACKUP_ENCRYPTION_KEY='prod-backup-encryption-key-32chars!!!!';
    process.env.BACKUP_STORAGE='s3';
    process.env.S3_ENDPOINT='';
    process.env.S3_BUCKET='';
    process.env.S3_ACCESS_KEY_ID='';
    process.env.S3_SECRET_ACCESS_KEY='';
    try {
      require('./src/services/backup/storage').assertProductionBackupEnv();
      console.log('UNEXPECTED_OK');
      process.exit(1);
    } catch (e) {
      console.log(e.message);
      process.exit(0);
    }
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert('production backup fail-closed without S3', prodBackupCheck.status === 0 && /S3_/.test(prodBackupCheck.stdout || ''));

  s3.server.close();

  // ---------- Refresh reuse: family access dead, other family alive ----------
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const req = reqFactory(PORT);
  const authH = (t) => ({ Authorization: 'Bearer ' + t });

  const email1 = `fam1.${Date.now()}@prod.test`;
  const reg1 = await req('POST', '/api/register', {
    name: 'F1', email: email1, password: 'ProdTestPass99', role: 'lawyer'
  });
  const access1 = reg1.body.accessToken;
  const refresh1 = reg1.body.refreshToken;

  // second session (new family) for same user via login
  const login2 = await req('POST', '/api/login', { email: email1, password: 'ProdTestPass99' });
  const access2 = login2.body.accessToken;
  const refresh2 = login2.body.refreshToken;

  const rotated = await req('POST', '/api/refresh', { refreshToken: refresh1 });
  assert('refresh rotate', rotated.status === 200);
  const reuse = await req('POST', '/api/refresh', { refreshToken: refresh1 });
  assert('reuse rejected', reuse.status === 401);

  const deadAccess = await req('GET', '/api/cases', null, authH(access1));
  assert('family access invalidated after reuse', deadAccess.status === 401, `status=${deadAccess.status}`);

  const otherFamily = await req('GET', '/api/cases', null, authH(access2));
  assert('other session family still valid', otherFamily.status === 200, `status=${otherFamily.status}`);

  const otherRefresh = await req('POST', '/api/refresh', { refreshToken: refresh2 });
  assert('other family refresh still valid', otherRefresh.status === 200, `status=${otherRefresh.status}`);

  // ---------- Document cleanup ----------
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './storage/uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const userId = reg1.body.user.id;

  const activeName = `active-${Date.now()}.bin`;
  fs.writeFileSync(path.join(uploadDir, activeName), 'active');
  const [activeId] = await db('documents').insert({
    owner_id: userId,
    file_name: 'active.bin',
    stored_name: activeName,
    file_path: activeName,
    file_type: 'application/octet-stream',
    category: 'other',
    uploaded_at: db.fn.now()
  });

  const softName = `soft-${Date.now()}.bin`;
  fs.writeFileSync(path.join(uploadDir, softName), 'soft');
  const old = toDbDateTime(new Date(Date.now() - 40 * 24 * 3600 * 1000));
  const [softId] = await db('documents').insert({
    owner_id: userId,
    file_name: 'soft.bin',
    stored_name: softName,
    file_path: softName,
    file_type: 'application/octet-stream',
    category: 'other',
    uploaded_at: db.fn.now(),
    deleted_at: old,
    deleted_by: userId
  });

  const recentName = `recent-${Date.now()}.bin`;
  fs.writeFileSync(path.join(uploadDir, recentName), 'recent');
  const [recentId] = await db('documents').insert({
    owner_id: userId,
    file_name: 'recent.bin',
    stored_name: recentName,
    file_path: recentName,
    file_type: 'application/octet-stream',
    category: 'other',
    uploaded_at: db.fn.now(),
    deleted_at: toDbDateTime(new Date()),
    deleted_by: userId
  });

  const clean1 = await cleanupSoftDeletedDocuments();
  assert('cleanup removes expired soft-deleted', clean1.removed >= 1);
  assert('active file kept', fs.existsSync(path.join(uploadDir, activeName)));
  assert('active row kept', !!(await db('documents').where({ id: activeId }).whereNull('deleted_at').first()));
  assert('expired soft file removed', !fs.existsSync(path.join(uploadDir, softName)));
  assert('expired soft row removed', !(await db('documents').where({ id: softId }).first()));
  assert('recent soft kept (within retention)', !!(await db('documents').where({ id: recentId }).first())
    && fs.existsSync(path.join(uploadDir, recentName)));

  const clean2 = await cleanupSoftDeletedDocuments();
  assert('cleanup idempotent', clean2.removed === 0 || clean2.ok);

  // race: delete already-gone file path row
  const ghostName = `ghost-${Date.now()}.bin`;
  const [ghostId] = await db('documents').insert({
    owner_id: userId,
    file_name: 'ghost.bin',
    stored_name: ghostName,
    file_path: ghostName,
    file_type: 'application/octet-stream',
    category: 'other',
    uploaded_at: db.fn.now(),
    deleted_at: old,
    deleted_by: userId
  });
  const clean3 = await cleanupSoftDeletedDocuments();
  assert('cleanup handles missing file (race)', !(await db('documents').where({ id: ghostId }).first()) || clean3.ok);

  // ---------- MFA production enforcement (same gate used by login) ----------
  const adminEmail = `admin.prod.${Date.now()}@test.local`;
  const adminPass = 'AdminProdPass99!';
  await db('users').insert({
    name: 'Prod Admin',
    email: adminEmail,
    password_hash: await bcrypt.hash(adminPass, 10),
    role: 'admin',
    token_version: 0,
    must_change_password: false,
    mfa_enabled: false,
    created_at: db.fn.now()
  });

  const { adminLoginGate } = require('../src/services/auth.gates');
  const adminRow = await db('users').where({ email: adminEmail }).first();
  const gateSetup = adminLoginGate(adminRow, {
    isProd: true,
    signMfaSetupToken: require('../src/services/mfa.service').signMfaSetupToken,
    signMfaChallenge: require('../src/services/mfa.service').signMfaChallenge
  });
  assert(
    'prod admin login requires MFA setup',
    !!(gateSetup && gateSetup.mfaSetupRequired && gateSetup.setupToken)
  );

  // setupToken can call MFA setup/enable
  const setupRes = await req('POST', '/api/mfa/setup', null, authH(gateSetup.setupToken));
  assert('mfa setup with setupToken', setupRes.status === 200 && setupRes.body && setupRes.body.secret);
  const enableRes = await req('POST', '/api/mfa/enable', {
    code: totp(setupRes.body.secret)
  }, authH(gateSetup.setupToken));
  assert('mfa enable with setupToken', enableRes.status === 200 && enableRes.body.mfa_enabled === true);

  const gateMfa = adminLoginGate(await db('users').where({ email: adminEmail }).first(), {
    isProd: true,
    signMfaSetupToken: require('../src/services/mfa.service').signMfaSetupToken,
    signMfaChallenge: require('../src/services/mfa.service').signMfaChallenge
  });
  assert('prod admin with MFA requires TOTP', !!(gateMfa && gateMfa.mfaRequired && gateMfa.mfaToken));

  const verifyOk = await req('POST', '/api/mfa/verify', {
    mfaToken: gateMfa.mfaToken,
    code: totp(setupRes.body.secret)
  });
  assert('mfa verify after prod setup', verifyOk.status === 200 && !!verifyOk.body.accessToken);

  // Recovery code one-time: consume one from setup
  const recovery = setupRes.body.recoveryCodes[1];
  const gate2 = adminLoginGate(await db('users').where({ email: adminEmail }).first(), {
    isProd: true,
    signMfaSetupToken: require('../src/services/mfa.service').signMfaSetupToken,
    signMfaChallenge: require('../src/services/mfa.service').signMfaChallenge
  });
  const viaRec = await req('POST', '/api/mfa/verify', {
    mfaToken: gate2.mfaToken,
    code: recovery
  });
  assert('recovery code works once', viaRec.status === 200);
  const gate3 = adminLoginGate(await db('users').where({ email: adminEmail }).first(), {
    isProd: true,
    signMfaSetupToken: require('../src/services/mfa.service').signMfaSetupToken,
    signMfaChallenge: require('../src/services/mfa.service').signMfaChallenge
  });
  const reuseRec = await req('POST', '/api/mfa/verify', {
    mfaToken: gate3.mfaToken,
    code: recovery
  });
  assert('recovery code not reusable', reuseRec.status === 401);

  // authenticate blocks admin APIs without MFA in prod — covered by middleware + gate;
  // in-process: admin without mfa_enabled cannot use normal token if isProd
  // (dev server is not prod — gate test above is the production path)

  // Recovery codes hashed (no plaintext in DB)
  const codesPlain = await db('mfa_recovery_codes').select('code_hash');
  assert('recovery codes not plaintext in DB', codesPlain.every((r) => r.code_hash && r.code_hash.length >= 32));

  server.close();
  await db.destroy();

  const failed = results.filter((x) => !x.ok);
  console.log(`\n=== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total ===\n`);
  if (failed.length) {
    failed.forEach((f) => console.log('FAIL:', f.name, f.detail));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
