/**
 * Smoke CRUD against MySQL via HTTP (in-process server).
 * Covers: auth, users, cases, clients, tasks, notes, events, documents,
 * reminders, subscriptions, payments, push subscriptions.
 *
 * Requires MySQL env + JWT secrets. Prefer MYSQL_TEST_DB for isolation.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const webpush = require('web-push');

process.env.DB_CLIENT = 'mysql';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:mysql-crud@legal.local';
}

const host = process.env.DB_HOST;
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD != null ? process.env.DB_PASSWORD : '';
const database = process.env.MYSQL_TEST_DB || process.env.DB_NAME;

if (!host || !user || !database) {
  console.error('FAIL: set DB_HOST, DB_USER, DB_NAME');
  process.exit(2);
}

process.env.DB_HOST = host;
process.env.DB_PORT = String(port);
process.env.DB_USER = user;
process.env.DB_PASSWORD = password;
process.env.DB_NAME = database;

const results = [];
function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function prepareDb() {
  const admin = await mysql.createConnection({
    host,
    port,
    user: process.env.MYSQL_ROOT_USER || user,
    password: process.env.MYSQL_ROOT_PASSWORD != null ? process.env.MYSQL_ROOT_PASSWORD : password,
    multipleStatements: true
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  // Ensure app user can access (when admin is root)
  try {
    await admin.query(
      `GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@'127.0.0.1'`,
      [user]
    );
    await admin.query('FLUSH PRIVILEGES');
  } catch { /* may already have rights / not root */ }
  await admin.end();
}

async function main() {
  await prepareDb();

  const db = require('../src/db/connection');
  const { createApp } = require('../src/app');
  const { ensureUploadDir } = require('../src/services/document.service');
  const { setPaymentProvider } = require('../src/services/payment');

  ensureUploadDir();
  await db.migrate.latest();

  setPaymentProvider({
    async requestPayment() {
      const authority = ('A' + crypto.randomBytes(16).toString('hex')).slice(0, 36);
      return { authority, paymentUrl: 'https://sandbox.zarinpal.com/pg/StartPay/' + authority, rawCode: 100 };
    },
    async verifyPayment() {
      return { ok: true, refId: 99, code: 100, message: 'Verified' };
    }
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const PORT = server.address().port;

  function req(method, urlPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = body == null ? null : (Buffer.isBuffer(body) ? body : JSON.stringify(body));
      const isJson = data && !Buffer.isBuffer(body) && typeof body === 'object';
      const r = http.request({
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method,
        headers: {
          ...(isJson ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
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
  const email = `mysql.crud.${Date.now()}@test.local`;
  const passwordUser = 'MysqlCrudPass99';

  let r = await req('POST', '/api/register', {
    name: 'MySQL Lawyer',
    email,
    password: passwordUser,
    role: 'lawyer'
  });
  assert('auth register', r.status === 201, `status=${r.status}`);
  let token = r.body && (r.body.accessToken || r.body.token);
  const userObj = r.body && r.body.user;
  assert('auth access token', !!token);
  assert('users payload', !!(userObj && userObj.id && userObj.email === email));

  r = await req('POST', '/api/login', { email, password: passwordUser });
  assert('auth login', r.status === 200 && !!(r.body && (r.body.accessToken || r.body.token)), `status=${r.status}`);
  token = r.body.accessToken || r.body.token;

  r = await req('POST', '/api/cases', {
    case_number: 'M-100',
    title: 'پرونده تست MySQL',
    status: 'active'
  }, authH(token));
  assert('cases create', r.status === 201, `status=${r.status}`);
  const caseId = r.body && r.body.id;
  assert('cases id', !!caseId);

  r = await req('GET', '/api/cases', null, authH(token));
  assert('cases list', r.status === 200 && Array.isArray(r.body));

  r = await req('PUT', `/api/cases/${caseId}`, { title: 'به‌روز MySQL' }, authH(token));
  assert('cases update', r.status === 200 && r.body && r.body.title === 'به‌روز MySQL', `status=${r.status}`);

  r = await req('POST', '/api/clients', {
    case_id: caseId,
    name: 'موکل تست',
    phone: '09120000000'
  }, authH(token));
  assert('clients create', r.status === 201, `status=${r.status}`);
  const clientId = r.body && r.body.id;
  assert('clients id', !!clientId);

  r = await req('GET', '/api/clients', null, authH(token));
  assert('clients list', r.status === 200 && Array.isArray(r.body));

  r = await req('POST', '/api/tasks', {
    case_id: caseId,
    title: 'وظیفه MySQL',
    status: 'todo',
    priority: 'med'
  }, authH(token));
  assert('tasks create', r.status === 201, `status=${r.status}`);
  const taskId = r.body && r.body.id;
  assert('tasks id', !!taskId);

  r = await req('PUT', `/api/tasks/${taskId}`, { title: 'وظیفه MySQL', status: 'done' }, authH(token));
  assert('tasks update', r.status === 200, `status=${r.status}`);

  r = await req('POST', '/api/notes', {
    case_id: caseId,
    title: 'یادداشت',
    content: 'متن تست',
    category: 'general'
  }, authH(token));
  assert('notes create', r.status === 201, `status=${r.status}`);
  const noteId = r.body && r.body.id;
  assert('notes id', !!noteId);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  r = await req('POST', '/api/events', {
    case_id: caseId,
    client_id: clientId,
    title: 'جلسه',
    type: 'meeting',
    date: tomorrow,
    time: '10:00',
    reminder: 60,
    description: 'رویداد تست'
  }, authH(token));
  assert('events create', r.status === 201, `status=${r.status}`);
  const eventId = r.body && r.body.id;
  assert('events id', !!eventId);

  r = await req('GET', '/api/reminders', null, authH(token));
  assert('reminders list', r.status === 200, `status=${r.status}`);

  // document via multipart
  const boundary = '----MysqlCrud' + crypto.randomBytes(8).toString('hex');
  // Minimal valid 1x1 PNG (allowed extension/mime)
  const fileBody = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="case_id"\r\n\r\n${caseId}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nother\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`
  ];
  const end = `\r\n--${boundary}--\r\n`;
  const multipart = Buffer.concat([
    Buffer.from(parts.join('')),
    fileBody,
    Buffer.from(end)
  ]);
  r = await new Promise((resolve, reject) => {
    const reqHttp = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': multipart.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    reqHttp.on('error', reject);
    reqHttp.write(multipart);
    reqHttp.end();
  });
  assert('documents upload', r.status === 201, `status=${r.status}`);
  const docId = r.body && r.body.id;
  assert('documents id', !!docId);

  r = await req('GET', '/api/documents', null, authH(token));
  assert('documents list', r.status === 200 && Array.isArray(r.body));

  r = await req('GET', '/api/subscription', null, authH(token));
  assert('subscriptions status', r.status === 200, `status=${r.status}`);

  r = await req('POST', '/api/subscription/checkout', {}, authH(token));
  assert('payments checkout', r.status === 200 && !!(r.body && (r.body.paymentUrl || r.body.authority || r.body.payment)), `status=${r.status} body=${JSON.stringify(r.body)}`);

  r = await req('POST', '/api/push/subscribe', {
    endpoint: `https://push.example.test/mysql/${crypto.randomBytes(8).toString('hex')}`,
    keys: { p256dh: 'B'.repeat(87), auth: crypto.randomBytes(16).toString('base64url') }
  }, authH(token));
  assert('push subscribe', r.status === 201 || r.status === 200, `status=${r.status} ${JSON.stringify(r.body)}`);

  r = await req('GET', '/api/push/subscriptions', null, authH(token));
  assert('push list', r.status === 200 && Array.isArray(r.body), `status=${r.status}`);

  if (noteId) {
    r = await req('DELETE', `/api/notes/${noteId}`, null, authH(token));
    assert('notes delete', r.status === 200, `status=${r.status}`);
  }
  if (taskId) {
    r = await req('DELETE', `/api/tasks/${taskId}`, null, authH(token));
    assert('tasks delete', r.status === 200, `status=${r.status}`);
  }
  if (eventId) {
    r = await req('DELETE', `/api/events/${eventId}`, null, authH(token));
    assert('events delete', r.status === 200, `status=${r.status}`);
  }
  if (docId) {
    r = await req('DELETE', `/api/documents/${docId}`, null, authH(token));
    assert('documents delete', r.status === 200, `status=${r.status}`);
  }
  if (clientId) {
    r = await req('DELETE', `/api/clients/${clientId}`, null, authH(token));
    assert('clients delete', r.status === 200, `status=${r.status}`);
  }
  if (caseId) {
    r = await req('DELETE', `/api/cases/${caseId}`, null, authH(token));
    assert('cases delete', r.status === 200, `status=${r.status}`);
  }

  server.close();
  await db.destroy();

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
  console.log('PASS  MySQL CRUD smoke OK');
}

main().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
