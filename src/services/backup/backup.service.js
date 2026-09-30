const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const config = require('../../config');
const { encryptBufferToFileParts, decryptFileParts } = require('../../utils/cryptoBox');
const { createBackupStorage, assertProductionBackupEnv } = require('./storage');

const root = path.join(__dirname, '..', '..', '..');
const backupRoot = path.join(root, 'backups');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function encryptionKey() {
  assertProductionBackupEnv();
  const key = process.env.BACKUP_ENCRYPTION_KEY || '';
  if (!key || String(key).length < 32) {
    if (config.isProd) {
      throw new Error('BACKUP_ENCRYPTION_KEY (≥32 chars or 64 hex) is required in production');
    }
    return 'dev-only-backup-encryption-key-change-me!!';
  }
  return key;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) n += copyDir(from, to);
    else {
      fs.copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

function walkFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ path: rel, data: fs.readFileSync(full) });
  }
  return out;
}

function packStaging(dir) {
  const files = walkFiles(dir).map((f) => ({
    path: f.path,
    data: f.data.toString('base64')
  }));
  return zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, files }), 'utf8'));
}

function unpackToDir(buf, dest) {
  const json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  for (const f of json.files || []) {
    const target = path.join(dest, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(f.data, 'base64'));
  }
}

function encryptPack(packBuf, key) {
  const { iv, tag, ciphertext } = encryptBufferToFileParts(packBuf, key);
  return Buffer.concat([Buffer.from('LGB1'), iv, tag, ciphertext]);
}

function decryptPack(encBuf, key) {
  if (encBuf.length < 4 + 12 + 16) throw new Error('invalid encrypted backup');
  if (encBuf.slice(0, 4).toString('utf8') !== 'LGB1') throw new Error('invalid backup magic');
  return decryptFileParts({
    iv: encBuf.slice(4, 16),
    tag: encBuf.slice(16, 32),
    ciphertext: encBuf.slice(32)
  }, key);
}

function mysqlEnv() {
  const c = config.knex.connection || {};
  return {
    host: c.host || process.env.DB_HOST || '127.0.0.1',
    port: String(c.port || process.env.DB_PORT || 3306),
    user: c.user || process.env.DB_USER || '',
    password: c.password != null ? String(c.password) : (process.env.DB_PASSWORD || ''),
    database: c.database || process.env.DB_NAME || ''
  };
}

function runMysqlTool(bin, args, password) {
  const env = { ...process.env };
  if (password !== undefined && password !== null) env.MYSQL_PWD = String(password);
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    env,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw new Error(`${bin} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${bin} exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
  return result;
}

function stageDatabase(dir) {
  if (config.dbClient === 'sqlite3') {
    const dbFile = config.knex.connection.filename;
    if (fs.existsSync(dbFile)) {
      copyFile(dbFile, path.join(dir, 'legal.sqlite'));
      for (const suf of ['-wal', '-shm']) {
        if (fs.existsSync(dbFile + suf)) copyFile(dbFile + suf, path.join(dir, 'legal.sqlite' + suf));
      }
      return 'legal.sqlite';
    }
    return null;
  }
  if (config.dbClient === 'mysql2' || config.dbClient === 'mysql') {
    const m = mysqlEnv();
    const outFile = path.join(dir, 'database.sql');
    runMysqlTool('mysqldump', [
      `-h${m.host}`, `-P${m.port}`, `-u${m.user}`,
      '--single-transaction', '--routines', '--triggers',
      '--default-character-set=utf8mb4',
      '--result-file=' + outFile,
      m.database
    ], m.password);
    return 'database.sql';
  }
  fs.writeFileSync(path.join(dir, 'DATABASE_EXTERNAL.txt'), 'Use host dump tools\n');
  return 'EXTERNAL';
}

function restoreDatabase(workDir) {
  if (config.dbClient === 'sqlite3') {
    const src = path.join(workDir, 'legal.sqlite');
    const dest = config.knex.connection.filename;
    if (!fs.existsSync(src)) throw new Error('legal.sqlite missing in backup');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyFile(src, dest);
    return dest;
  }
  if (config.dbClient === 'mysql2' || config.dbClient === 'mysql') {
    const sql = path.join(workDir, 'database.sql');
    if (!fs.existsSync(sql)) throw new Error('database.sql missing');
    const m = mysqlEnv();
    const result = spawnSync(
      'mysql',
      [`-h${m.host}`, `-P${m.port}`, `-u${m.user}`, '--default-character-set=utf8mb4', m.database],
      {
        input: fs.readFileSync(sql, 'utf8'),
        encoding: 'utf8',
        env: { ...process.env, MYSQL_PWD: String(m.password) },
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true
      }
    );
    if (result.status !== 0) throw new Error(`mysql restore failed: ${(result.stderr || '').trim()}`);
    return m.database;
  }
  return null;
}

/**
 * Create encrypted backup, upload only .enc, apply retention.
 * @param {{ storage?: object }} opts — inject storage for tests
 */
async function createEncryptedBackup(opts = {}) {
  const isProd = config.isProd || (process.env.NODE_ENV || '') === 'production';
  if (isProd) assertProductionBackupEnv();

  const id = `backup-${stamp()}`;
  const staging = path.join(backupRoot, `.staging-${id}`);
  fs.mkdirSync(staging, { recursive: true, mode: 0o750 });
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o750 });
  fs.writeFileSync(path.join(backupRoot, '.htaccess'), 'Require all denied\n', 'utf8');

  const meta = {
    created_at: new Date().toISOString(),
    db_client: config.dbClient,
    encrypted: true,
    cipher: 'aes-256-gcm'
  };

  try {
    meta.database = stageDatabase(staging);
    meta.uploads_copied = copyDir(config.uploadDir, path.join(staging, 'uploads'));
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(meta, null, 2));

    const key = encryptionKey();
    const encBuf = encryptPack(packStaging(staging), key);
    const encName = `${id}.enc`;
    const remoteKey = `legal-app/${encName}`;

    const storage = opts.storage || createBackupStorage();
    const remote = await storage.putObject(remoteKey, encBuf, 'application/octet-stream');

    // Production: never keep plaintext or local enc copy as source of truth
    const keepPlain = !isProd && String(process.env.BACKUP_KEEP_PLAINTEXT || '').toLowerCase() === 'true';
    const keepLocalEnc = !isProd && String(process.env.BACKUP_KEEP_LOCAL_ENC || 'true').toLowerCase() !== 'false';

    let localEnc = null;
    if (keepLocalEnc) {
      localEnc = path.join(backupRoot, encName);
      fs.writeFileSync(localEnc, encBuf);
      try { fs.chmodSync(localEnc, 0o640); } catch { /* ignore */ }
    }

    if (!keepPlain) {
      fs.rmSync(staging, { recursive: true, force: true });
    }

    const retention = await applyRetention(storage, {
      prefix: 'legal-app/',
      keep: Number(process.env.BACKUP_RETENTION_COUNT || 14)
    });

    return {
      ok: true,
      key: remoteKey,
      remote,
      local_enc: localEnc,
      plaintext_kept: keepPlain,
      retention,
      meta
    };
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

async function applyRetention(storage, { prefix = 'legal-app/', keep = 14 } = {}) {
  if (!keep || keep < 1) return { deleted: 0 };
  if (typeof storage.listObjects !== 'function' || typeof storage.deleteObject !== 'function') {
    return { deleted: 0, skipped: true };
  }
  const objects = (await storage.listObjects(prefix))
    .filter((o) => String(o.key).endsWith('.enc'))
    .sort((a, b) => {
      const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return tb - ta;
    });
  const toDelete = objects.slice(keep);
  for (const obj of toDelete) {
    await storage.deleteObject(obj.key);
  }
  return { deleted: toDelete.length, kept: Math.min(objects.length, keep) };
}

/**
 * Download .enc from storage (or local path), decrypt, restore DB + uploads.
 */
async function restoreFromEncrypted(source, opts = {}) {
  const key = encryptionKey();
  let encBuf;
  if (Buffer.isBuffer(source)) {
    encBuf = source;
  } else if (typeof source === 'string' && source.endsWith('.enc') && fs.existsSync(source)) {
    encBuf = fs.readFileSync(source);
  } else if (typeof source === 'string') {
    const storage = opts.storage || createBackupStorage();
    encBuf = await storage.getObject(source);
  } else {
    throw new Error('restore source must be .enc path, remote key, or buffer');
  }

  const pack = decryptPack(encBuf, key);
  const workDir = path.join(backupRoot, `restore-${stamp()}`);
  unpackToDir(pack, workDir);

  const dbTarget = restoreDatabase(workDir);
  const upSrc = path.join(workDir, 'uploads');
  let uploads = 0;
  if (fs.existsSync(upSrc)) uploads = copyDir(upSrc, config.uploadDir);

  if (!opts.keepWorkDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  return { ok: true, database: dbTarget, uploads, workDir: opts.keepWorkDir ? workDir : null };
}

module.exports = {
  createEncryptedBackup,
  restoreFromEncrypted,
  applyRetention,
  encryptPack,
  decryptPack,
  packStaging,
  unpackToDir,
  encryptionKey,
  backupRoot
};
