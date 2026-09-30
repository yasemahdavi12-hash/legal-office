/**
 * Secure document requests — lawyer/client flows, IDOR, validation.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const config = require('../src/config');
const { createApp } = require('../src/app');
const { insertReturningId } = require('../src/utils/dbHelpers');

let PORT = 0;
let server;
const results = [];

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
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
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function multipartSubmit(token, caseId, requestId, extraFields = {}) {
  const boundary = '----DocReq' + crypto.randomBytes(6).toString('hex');
  const fileBody = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  let parts = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="id.png"\r\nContent-Type: image/png\r\n\r\n`;
  for (const [k, v] of Object.entries(extraFields)) {
    parts = `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n` + parts;
  }
  const multipart = Buffer.concat([Buffer.from(parts), fileBody, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/portal/cases/${caseId}/document-requests/${requestId}/submit`,
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
        try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    r.write(multipart);
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

async function registerLawyer(tag) {
  const reg = await req('POST', '/api/register', {
    name: 'وکیل ' + tag,
    email: `law.req.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'lawyer'
  });
  return { token: reg.body.accessToken || reg.body.token, userId: reg.body.user?.id };
}

async function createClientUser(tag, phone) {
  const email = `client.req.${tag}@test.local`;
  const password = 'ClientPass99!';
  const id = await db('users').insert({
    name: 'موکل ' + tag,
    email,
    phone,
    password_hash: await bcrypt.hash(password, 12),
    role: 'client',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });
  const userId = Array.isArray(id) ? id[0] : id;
  const login = await req('POST', '/api/login', { email, password });
  return { userId, token: login.body.accessToken || login.body.token };
}

async function setupActiveClient(lawToken, caseId, phone, tag) {
  const clientRec = await req('POST', '/api/clients', {
    name: 'موکل ' + tag,
    phone,
    case_id: caseId
  }, auth(lawToken));
  const clientId = clientRec.body?.id;
  const user = await createClientUser(tag, phone);
  await db('clients').where({ id: clientId }).update({ user_id: user.userId });
  const inv = await req('POST', `/api/cases/${caseId}/client-access/invite`, { clientId }, auth(lawToken));
  await req('POST', `/api/portal/client-access/${inv.body.id}/accept`, {}, auth(user.token));
  return { clientId, ...user };
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nCase document request tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const lawA = await registerLawyer(`a.${tag}`);
  const lawB = await registerLawyer(`b.${tag}`);
  const caseA = await req('POST', '/api/cases', { case_number: `RA-${tag}`, title: 'A' }, auth(lawA.token));
  const caseB = await req('POST', '/api/cases', { case_number: `RB-${tag}`, title: 'B' }, auth(lawB.token));
  const caseIdA = caseA.body?.id;
  const caseIdB = caseB.body?.id;

  const clientA = await setupActiveClient(lawA.token, caseIdA, '09120001111', `a.${tag}`);
  const clientA2 = await setupActiveClient(lawA.token, caseIdA, '09120002222', `a2.${tag}`);
  const clientB = await setupActiveClient(lawB.token, caseIdB, '09120003333', `b.${tag}`);

  const create = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId,
    title: 'کارت ملی',
    description: 'تصویر واضح'
  }, auth(lawA.token));
  assert('1 lawyer can create request', create.status === 201 && create.body?.status === 'pending', `status ${create.status}`);
  const requestId = create.body?.id;

  assert('2 lawyer cannot create on other case', (await req('POST', `/api/cases/${caseIdB}/document-requests`, {
    clientId: clientB.clientId, title: 'x', description: 'y'
  }, auth(lawA.token))).status === 404);

  const listOwn = await req('GET', `/api/cases/${caseIdA}/document-requests`, null, auth(lawA.token));
  assert('3 lawyer can list own case requests', listOwn.status === 200 && listOwn.body?.length >= 1);

  assert('4 another lawyer cannot list', (await req('GET', `/api/cases/${caseIdA}/document-requests`, null, auth(lawB.token))).status === 404);

  const listClient = await req('GET', `/api/portal/cases/${caseIdA}/document-requests`, null, auth(clientA.token));
  assert('5 client can list own requests', listClient.status === 200 && listClient.body?.length === 1);

  const createB = await req('POST', `/api/cases/${caseIdB}/document-requests`, {
    clientId: clientB.clientId, title: 'B doc', description: 'only B'
  }, auth(lawB.token));
  assert('6 client cannot list another case requests', (await req('GET', `/api/portal/cases/${caseIdB}/document-requests`, null, auth(clientA.token))).status === 404);

  assert('7 client cannot submit another client request', (await multipartSubmit(clientA2.token, caseIdA, requestId)).status === 404);

  const listA2 = await req('GET', `/api/portal/cases/${caseIdA}/document-requests`, null, auth(clientA2.token));
  assert('8 client cannot see another client requests on same case', listA2.status === 200 && listA2.body?.length === 0, `len ${listA2.body?.length}`);

  const pendingCase = await req('POST', '/api/cases', { case_number: `RP-${tag}`, title: 'P' }, auth(lawB.token));
  const pendingClient = await req('POST', '/api/clients', { name: 'P', phone: '09120004444', case_id: pendingCase.body.id }, auth(lawB.token));
  const pendingUser = await createClientUser(`p.${tag}`, '09120004444');
  await db('clients').where({ id: pendingClient.body.id }).update({ user_id: pendingUser.userId });
  const invP = await req('POST', `/api/cases/${pendingCase.body.id}/client-access/invite`, { clientId: pendingClient.body.id }, auth(lawB.token));
  const reqP = await req('POST', `/api/cases/${pendingCase.body.id}/document-requests`, {
    clientId: pendingClient.body.id, title: 't', description: 'd'
  }, auth(lawB.token));
  assert('10 pending invitation cannot submit', (await multipartSubmit(pendingUser.token, pendingCase.body.id, reqP.body.id)).status === 404);

  const reqRevoked = await req('POST', `/api/cases/${caseIdB}/document-requests`, {
    clientId: clientB.clientId, title: 'rev', description: 'd'
  }, auth(lawB.token));
  const accB = await db('case_client_access').where({ case_id: caseIdB, client_id: clientB.clientId }).first();
  await req('DELETE', `/api/cases/${caseIdB}/client-access/${accB.id}`, null, auth(lawB.token));
  assert('9 revoked access cannot submit', (await multipartSubmit(clientB.token, caseIdB, reqRevoked.body.id)).status === 404);

  const submitOk = await multipartSubmit(clientA.token, caseIdA, requestId);
  assert('11 client can submit valid document', submitOk.status === 200 && submitOk.body?.status === 'submitted');
  assert('12 pending -> submitted', submitOk.body?.documentId != null);

  const approve = await req('POST', `/api/cases/${caseIdA}/document-requests/${requestId}/approve`, {}, auth(lawA.token));
  assert('13 lawyer can approve', approve.status === 200 && approve.body?.status === 'approved');

  const req2 = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId, title: 'رد شونده', description: 'd'
  }, auth(lawA.token));
  await multipartSubmit(clientA.token, caseIdA, req2.body.id);
  const reject = await req('POST', `/api/cases/${caseIdA}/document-requests/${req2.body.id}/reject`, {
    rejectionReason: 'تصویر خوانا نیست'
  }, auth(lawA.token));
  assert('14 lawyer can reject', reject.status === 200 && reject.body?.status === 'rejected');
  assert('15 rejection reason stored', reject.body?.rejectionReason?.includes('خوانا'));

  assert('16 lawyer cannot approve other case', (await req('POST', `/api/cases/${caseIdB}/document-requests/${createB.body.id}/approve`, {}, auth(lawA.token))).status === 404);
  assert('17 lawyer cannot reject other case', (await req('POST', `/api/cases/${caseIdB}/document-requests/${createB.body.id}/reject`, { rejectionReason: 'x' }, auth(lawA.token))).status === 404);

  const reqCancel = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId, title: 'لغو', description: 'd'
  }, auth(lawA.token));
  const cancel = await req('POST', `/api/cases/${caseIdA}/document-requests/${reqCancel.body.id}/cancel`, {}, auth(lawA.token));
  assert('18 lawyer can cancel pending', cancel.status === 200 && cancel.body?.status === 'cancelled');

  assert('19 invalid requestId', (await req('POST', `/api/cases/${caseIdA}/document-requests/99999999/approve`, {}, auth(lawA.token))).status === 404);
  assert('20 invalid caseId', (await req('GET', `/api/cases/99999999/document-requests`, null, auth(lawA.token))).status === 404);

  assert('21 empty title rejected', (await req('POST', `/api/cases/${caseIdA}/document-requests`, { clientId: clientA.clientId, title: '   ' }, auth(lawA.token))).status === 400);
  assert('22 oversized title rejected', (await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId, title: 'x'.repeat(201)
  }, auth(lawA.token))).status === 400);
  assert('23 oversized description rejected', (await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId, title: 'ok', description: 'd'.repeat(2001)
  }, auth(lawA.token))).status === 400);

  const reqRej = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId, title: 'rej len', description: 'd'
  }, auth(lawA.token));
  await multipartSubmit(clientA.token, caseIdA, reqRej.body.id);
  assert('24 oversized rejection reason rejected', (await req('POST', `/api/cases/${caseIdA}/document-requests/${reqRej.body.id}/reject`, {
    rejectionReason: 'r'.repeat(2001)
  }, auth(lawA.token))).status === 400);

  const uploadDir = path.resolve(config.uploadDir);
  fs.mkdirSync(uploadDir, { recursive: true });
  const stored = `law-only-${crypto.randomBytes(6).toString('hex')}.png`;
  fs.writeFileSync(path.join(uploadDir, stored), Buffer.from('x'));
  const lawDocId = await insertReturningId(db, 'documents', {
    case_id: caseIdA,
    owner_id: lawA.userId,
    file_name: 'private',
    stored_name: stored,
    file_path: stored,
    file_type: 'image/png',
    category: 'other',
    uploaded_at: db.fn.now()
  });

  const reqAttach = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId, title: 'attach test', description: 'd'
  }, auth(lawA.token));
  const submitAttach = await multipartSubmit(clientA.token, caseIdA, reqAttach.body.id, { document_id: String(lawDocId) });
  assert('25 document ownership via upload only', submitAttach.status === 200 && submitAttach.body?.documentId !== lawDocId);

  const reqB = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA2.clientId, title: 'only A2', description: 'd'
  }, auth(lawA.token));
  assert('26 cross-client submit blocked', (await multipartSubmit(clientA.token, caseIdA, reqB.body.id)).status === 404);

  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const portalSrc = fs.readFileSync(path.join(__dirname, '..', 'client-portal.html'), 'utf8');
  assert('27 XSS-safe render uses textContent',
    /function renderCaseDocRequests[\s\S]*\.textContent/.test(indexSrc)
      && /function renderPortalDocRequests[\s\S]*\.textContent/.test(portalSrc));

  assert('28 invalid status transition approve pending', (await req('POST', `/api/cases/${caseIdA}/document-requests/${reqCancel.body.id}/approve`, {}, auth(lawA.token))).status === 400);

  assert('29 cancelled cannot submit', (await multipartSubmit(clientA.token, caseIdA, reqCancel.body.id)).status === 400);

  assert('30 approved cannot submit again', (await multipartSubmit(clientA.token, caseIdA, requestId)).status === 400);

  try {
    await db('case_document_requests').whereIn('case_id', [caseIdA, caseIdB, pendingCase.body?.id].filter(Boolean)).del();
    await db('documents').whereIn('id', [lawDocId, submitAttach.body?.documentId, submitOk.body?.documentId].filter(Boolean)).del();
    await db('case_client_access').whereIn('case_id', [caseIdA, caseIdB]).del();
    await db('clients').whereIn('id', [clientA.clientId, clientA2.clientId, clientB.clientId]).del();
    await db('cases').whereIn('id', [caseIdA, caseIdB]).del();
    await db('users').whereIn('id', [lawA.userId, lawB.userId, clientA.userId, clientA2.userId, clientB.userId]).del();
  } catch { /* ignore */ }

  await new Promise((r) => server.close(r));
  const failed = results.filter((x) => !x.ok);
  console.log(`\n=== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total ===\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try { if (server) await new Promise((r) => server.close(r)); } catch { /* */ }
  process.exit(1);
});
