/**
 * Client portal case isolation — same lawyer, multiple cases; IDOR on all portal APIs.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');

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

function multipartSubmit(token, caseId, requestId) {
  const boundary = '----Iso' + crypto.randomBytes(6).toString('hex');
  const fileBody = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const parts = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="id.png"\r\nContent-Type: image/png\r\n\r\n`;
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
    email: `law.iso.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'lawyer'
  });
  return { token: reg.body.accessToken || reg.body.token, userId: reg.body.user?.id };
}

async function registerClientUser(tag, phone) {
  const email = `client.iso.${tag}@test.local`;
  const password = 'ClientPass99!';
  const reg = await req('POST', '/api/portal/register', {
    name: 'موکل ' + tag,
    email,
    password,
    phone
  });
  return {
    userId: reg.body.user?.id,
    token: reg.body.accessToken || reg.body.token,
    email,
    password
  };
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nClient portal isolation tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
  const phone = '09138887766';
  const law = await registerLawyer(tag);
  const caseA = await req('POST', '/api/cases', { case_number: `IA-${tag}`, title: 'Case A' }, auth(law.token));
  const caseB = await req('POST', '/api/cases', { case_number: `IB-${tag}`, title: 'Case B' }, auth(law.token));
  const caseIdA = caseA.body?.id;
  const caseIdB = caseB.body?.id;

  const clA = await req('POST', '/api/clients', { name: 'موکل A', phone, case_id: caseIdA }, auth(law.token));
  const clB = await req('POST', '/api/clients', { name: 'موکل B', phone, case_id: caseIdB }, auth(law.token));
  const clientIdA = clA.body?.id;
  const clientIdB = clB.body?.id;

  const clientUser = await registerClientUser(tag, phone);
  const invA = await req('POST', `/api/cases/${caseIdA}/client-access/invite`, { clientId: clientIdA }, auth(law.token));
  await req('POST', `/api/portal/client-access/${invA.body.id}/accept`, {}, auth(clientUser.token));

  await req('POST', `/api/cases/${caseIdB}/client-access/invite`, { clientId: clientIdB }, auth(law.token));

  const list = await req('GET', '/api/portal/cases', null, auth(clientUser.token));
  const ids = (list.body || []).map((c) => c.id);
  assert('1 Client A sees only Case A', list.status === 200 && ids.length === 1 && ids[0] === caseIdA, `ids=${ids.join(',')}`);
  assert('2 Client A does not see Case B', !ids.includes(caseIdB));

  assert('3 Client A cannot access Case B by caseId', (await req('GET', `/api/portal/cases/${caseIdB}`, null, auth(clientUser.token))).status === 404);
  assert('4 Client A cannot read Case B messages', (await req('GET', `/api/portal/cases/${caseIdB}/messages`, null, auth(clientUser.token))).status === 404);
  assert('5 Client A cannot send message to Case B', (await req('POST', `/api/portal/cases/${caseIdB}/messages`, { body: 'x' }, auth(clientUser.token))).status === 404);
  assert('6 Client A cannot read Case B documents', (await req('GET', `/api/portal/cases/${caseIdB}/documents`, null, auth(clientUser.token))).status === 404);
  assert('7 Client A cannot download Case B documents', (await req('GET', `/api/portal/cases/${caseIdB}/documents/1/download`, null, auth(clientUser.token))).status === 404);
  assert('8 Client A cannot read Case B document requests', (await req('GET', `/api/portal/cases/${caseIdB}/document-requests`, null, auth(clientUser.token))).status === 404);

  const reqB = await req('POST', `/api/cases/${caseIdB}/document-requests`, {
    clientId: clientIdB,
    title: 'مدرک B',
    description: 'd'
  }, auth(law.token));
  assert('9 Client A cannot submit Case B document request', (await multipartSubmit(clientUser.token, caseIdB, reqB.body?.id)).status === 404);

  assert('10 Pending invitation does NOT grant case access', (await req('GET', `/api/portal/cases/${caseIdB}`, null, auth(clientUser.token))).status === 404);

  const accessA = await db('case_client_access').where({ case_id: caseIdA, client_id: clientIdA }).first();
  await req('DELETE', `/api/cases/${caseIdA}/client-access/${accessA.id}`, null, auth(law.token));
  assert('11 Revoked access removes case access immediately', (await req('GET', `/api/portal/cases/${caseIdA}`, null, auth(clientUser.token))).status === 404);

  const reinv = await req('POST', `/api/cases/${caseIdA}/client-access/invite`, { clientId: clientIdA }, auth(law.token));
  await req('POST', `/api/portal/client-access/${reinv.body.id}/accept`, {}, auth(clientUser.token));

  const otherPhone = '09137776655';
  const other = await registerClientUser(`other.${tag}`, otherPhone);
  const clOther = await req('POST', '/api/clients', { name: 'Other', phone: otherPhone, case_id: caseIdB }, auth(law.token));
  const invOther = await req('POST', `/api/cases/${caseIdB}/client-access/invite`, { clientId: clOther.body.id }, auth(law.token));
  await req('POST', `/api/portal/client-access/${invOther.body.id}/accept`, {}, auth(other.token));
  const listOther = await req('GET', '/api/portal/cases', null, auth(other.token));
  const otherIds = (listOther.body || []).map((c) => c.id);
  assert('12 Another client case remains invisible to Client A', !(await req('GET', '/api/portal/cases', null, auth(clientUser.token))).body?.some((c) => c.id === caseIdB));
  assert('12b Other client only sees Case B', otherIds.length === 1 && otherIds[0] === caseIdB, `otherIds=${otherIds.join(',')}`);

  const lawCases = await req('GET', '/api/cases', null, auth(law.token));
  assert('13 Lawyer can still see their own cases normally', lawCases.status === 200 && lawCases.body?.length >= 2);

  assert('13b Client cannot use lawyer cases API', (await req('GET', '/api/cases', null, auth(clientUser.token))).status === 403);

  assert('14 regression messaging still works on Case A', (await req('POST', `/api/portal/cases/${caseIdA}/messages`, { body: 'hi' }, auth(clientUser.token))).status === 201);
  assert('14b regression lawyer messaging', (await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'law' }, auth(law.token))).status === 201);

  const docReqA = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientIdA,
    title: 'کارت',
    description: 'd'
  }, auth(law.token));
  assert('14c regression document-request list portal', (await req('GET', `/api/portal/cases/${caseIdA}/document-requests`, null, auth(clientUser.token))).status === 200);

  assert('15 security regression spot-check — client case IDOR 404', (await req('GET', `/api/cases/${caseIdA}`, null, auth(clientUser.token))).status === 404);

  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} tests, ${failed.length} failed\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  if (server) server.close();
  process.exit(1);
});
