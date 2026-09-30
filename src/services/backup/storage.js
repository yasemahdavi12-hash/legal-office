const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

/**
 * Backup remote storage abstraction (local + S3-compatible).
 * Only encrypted .enc objects should be written by callers.
 */
class LocalBackupStorage {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async putObject(key, body) {
    if (!String(key).endsWith('.enc')) {
      throw new Error('Only .enc encrypted backups may be stored remotely');
    }
    const dest = path.join(this.rootDir, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o750 });
    fs.writeFileSync(dest, body);
    return { key, location: dest };
  }

  async getObject(key) {
    const dest = path.join(this.rootDir, key);
    if (!fs.existsSync(dest)) throw new Error('object not found');
    return fs.readFileSync(dest);
  }

  async listObjects(prefix = '') {
    const base = path.join(this.rootDir, prefix);
    const root = this.rootDir;
    const out = [];
    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else {
          out.push({
            key: path.relative(root, full).replace(/\\/g, '/'),
            lastModified: st.mtime,
            size: st.size
          });
        }
      }
    }
    if (fs.existsSync(base) && fs.statSync(base).isFile()) {
      const st = fs.statSync(base);
      out.push({ key: prefix.replace(/\\/g, '/'), lastModified: st.mtime, size: st.size });
    } else {
      walk(fs.existsSync(base) ? base : this.rootDir);
      if (prefix) {
        return out.filter((o) => o.key.startsWith(prefix.replace(/\\/g, '/')));
      }
    }
    return out;
  }

  async deleteObject(key) {
    const dest = path.join(this.rootDir, key);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
}

/** In-process store for integration tests (same contract as remote). */
class MemoryBackupStorage {
  constructor() {
    this.objects = new Map();
  }

  async putObject(key, body) {
    if (!String(key).endsWith('.enc')) {
      throw new Error('Only .enc encrypted backups may be stored remotely');
    }
    this.objects.set(key, Buffer.from(body));
    return { key, location: `memory://${key}` };
  }

  async getObject(key) {
    if (!this.objects.has(key)) throw new Error('object not found');
    return this.objects.get(key);
  }

  async listObjects(prefix = '') {
    const out = [];
    for (const [key, buf] of this.objects.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        out.push({ key, lastModified: new Date(), size: buf.length });
      }
    }
    return out;
  }

  async deleteObject(key) {
    this.objects.delete(key);
  }
}

function hmac(key, data, enc) {
  return crypto.createHmac('sha256', key).update(data, typeof data === 'string' ? 'utf8' : undefined).digest(enc);
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

class S3CompatibleBackupStorage {
  constructor({
    endpoint,
    region = 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle = true
  }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 storage requires endpoint, bucket, accessKeyId, secretAccessKey');
    }
    this.endpoint = endpoint.replace(/\/$/, '');
    this.region = region;
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.forcePathStyle = forcePathStyle;
  }

  _urlFor(key, query = '') {
    const u = new URL(this.endpoint);
    if (this.forcePathStyle) {
      u.pathname = `/${this.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    } else {
      u.host = `${this.bucket}.${u.host}`;
      u.pathname = `/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
    if (query) u.search = query.startsWith('?') ? query : `?${query}`;
    return u;
  }

  _sign(method, url, headers, bodyBuf) {
    const amzDate = headers['x-amz-date'];
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = headers['x-amz-content-sha256'];
    const canonicalHeaders =
      `host:${url.host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      url.pathname,
      url.search ? url.search.slice(1) : '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign, 'hex');
    return `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  async putObject(key, body) {
    if (!String(key).endsWith('.enc')) {
      throw new Error('Only .enc encrypted backups may be stored remotely');
    }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const url = this._urlFor(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const headers = {
      Host: url.host,
      'x-amz-content-sha256': sha256Hex(buf),
      'x-amz-date': amzDate,
      'Content-Length': buf.length
    };
    headers.Authorization = this._sign('PUT', url, headers, buf);
    await this._request(url, { method: 'PUT', headers }, buf);
    return { key, location: url.toString() };
  }

  async getObject(key) {
    const url = this._urlFor(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const emptyHash = sha256Hex(Buffer.alloc(0));
    const headers = {
      Host: url.host,
      'x-amz-content-sha256': emptyHash,
      'x-amz-date': amzDate
    };
    headers.Authorization = this._sign('GET', url, headers, Buffer.alloc(0));
    return this._request(url, { method: 'GET', headers });
  }

  async listObjects(prefix = '') {
    const u = new URL(this.endpoint);
    if (this.forcePathStyle) u.pathname = `/${this.bucket}`;
    else u.host = `${this.bucket}.${u.host}`;
    u.search = `list-type=2&prefix=${encodeURIComponent(prefix)}`;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const emptyHash = sha256Hex(Buffer.alloc(0));
    const headers = {
      Host: u.host,
      'x-amz-content-sha256': emptyHash,
      'x-amz-date': amzDate
    };
    headers.Authorization = this._sign('GET', u, headers, Buffer.alloc(0));
    const xml = (await this._request(u, { method: 'GET', headers })).toString('utf8');
    const out = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let m;
    while ((m = re.exec(xml))) {
      out.push({ key: m[1], lastModified: new Date(), size: 0 });
    }
    return out;
  }

  async deleteObject(key) {
    const url = this._urlFor(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const emptyHash = sha256Hex(Buffer.alloc(0));
    const headers = {
      Host: url.host,
      'x-amz-content-sha256': emptyHash,
      'x-amz-date': amzDate
    };
    headers.Authorization = this._sign('DELETE', url, headers, Buffer.alloc(0));
    await this._request(url, { method: 'DELETE', headers });
  }

  _request(url, options, body) {
    const lib = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, options, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(buf);
          else reject(new Error(`S3 ${options.method} failed: ${res.statusCode} ${buf.toString('utf8').slice(0, 200)}`));
        });
      });
      req.on('error', reject);
      if (body && body.length) req.write(body);
      req.end();
    });
  }
}

function assertProductionBackupEnv() {
  const isProd = (process.env.NODE_ENV || '') === 'production';
  if (!isProd) return;
  const key = process.env.BACKUP_ENCRYPTION_KEY || '';
  if (!key || String(key).length < 32) {
    throw new Error('[backup] BACKUP_ENCRYPTION_KEY (≥32) required in production');
  }
  const driver = (process.env.BACKUP_STORAGE || 's3').toLowerCase();
  if (driver !== 's3' && driver !== 's3-compatible') {
    throw new Error('[backup] Production requires BACKUP_STORAGE=s3 (off-server)');
  }
  if (!process.env.S3_ENDPOINT || !process.env.S3_BUCKET
    || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    throw new Error('[backup] S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY required in production');
  }
}

function createBackupStorage(configLike = {}) {
  assertProductionBackupEnv();
  const isProd = (process.env.NODE_ENV || '') === 'production';
  const driver = (process.env.BACKUP_STORAGE || (isProd ? 's3' : 'local') || configLike.driver || 'local').toLowerCase();
  if (driver === 's3' || driver === 's3-compatible') {
    return new S3CompatibleBackupStorage({
      endpoint: process.env.S3_ENDPOINT || configLike.endpoint,
      region: process.env.S3_REGION || configLike.region || 'us-east-1',
      bucket: process.env.S3_BUCKET || configLike.bucket,
      accessKeyId: process.env.S3_ACCESS_KEY_ID || configLike.accessKeyId,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || configLike.secretAccessKey,
      forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false'
    });
  }
  if (isProd) {
    throw new Error('[backup] Production forbids local backup storage');
  }
  const root = process.env.BACKUP_LOCAL_DIR
    || configLike.localDir
    || path.join(__dirname, '..', '..', 'backups', 'remote');
  return new LocalBackupStorage(root);
}

module.exports = {
  LocalBackupStorage,
  MemoryBackupStorage,
  S3CompatibleBackupStorage,
  createBackupStorage,
  assertProductionBackupEnv
};
