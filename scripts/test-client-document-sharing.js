/**
 * Client portal document sharing — lawyer share, portal list/download, IDOR.
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
          resolve({ status: res.statusCode, body: json, headers: res.headers, raw });
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

async function registerLawyer(tag) {
  const email = `law.doc.${tag}@test.local`;
  const password = 'LawyerPass99!';
  const reg = await req('POST', '/api/register', {
    name: 'وکیل ' + tag,
    email,
    password,
    role: 'lawyer'
  });
  return {
    token: reg.body.accessToken || reg.body.token,
    userId: reg.body.user?.id
  };
}

async function createClientUser(tag, phone) {
  const email = `client.doc.${tag}@test.local`;
  const password = 'ClientPass99!';
  const id = await db('users').insert({
    name: 'موکل ' + tag,
    email,
    phone: phone || null,
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

async function insertDocument(ownerId, caseId, label) {
  const stored = `doc-${crypto.randomBytes(10).toString('hex')}.pdf`;
  const uploadDir = path.resolve(config.uploadDir);
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, stored), '%PDF-1.4\n% test');
  const docId = await insertReturningId(db, 'documents', {
    case_id: caseId,
    owner_id: ownerId,
    file_name: label,
    stored_name: stored,
    file_path: stored,
    file_type: 'application/pdf',
    category: 'other',
    file_size: 12,
    uploaded_at: db.fn.now()
  });
  return docId;
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nClient document sharing tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const lawA = await registerLawyer(`a.${tag}`);
  const lawB = await registerLawyer(`b.${tag}`);

  const caseA = await req('POST', '/api/cases', { case_number: `DA-${tag}`, title: 'A' }, auth(lawA.token));
  const caseB = await req('POST', '/api/cases', { case_number: `DB-${tag}`, title: 'B' }, auth(lawB.token));
  const caseIdA = caseA.body?.id;
  const caseIdB = caseB.body?.id;

  const clientA = await req('POST', '/api/clients', {
    name: 'موکل A',
    phone: '09121110001',
    case_id: caseIdA
  }, auth(lawA.token));
  const clientIdA = clientA.body?.id;

  const clientB = await req('POST', '/api/clients', {
    name: 'موکل B',
    phone: '09121110002',
    case_id: caseIdB
  }, auth(lawB.token));
  const clientIdB = clientB.body?.id;

  const userA = await createClientUser(`a.${tag}`, '09121110001');
  const userB = await createClientUser(`b.${tag}`, '09121110002');
  await db('clients').where({ id: clientIdA }).update({ user_id: userA.userId });
  await db('clients').where({ id: clientIdB }).update({ user_id: userB.userId });

  const invA = await req('POST', `/api/cases/${caseIdA}/client-access/invite`, { clientId: clientIdA }, auth(lawA.token));
  await req('POST', `/api/portal/client-access/${invA.body.id}/accept`, {}, auth(userA.token));
  const invB = await req('POST', `/api/cases/${caseIdB}/client-access/invite`, { clientId: clientIdB }, auth(lawB.token));
  await req('POST', `/api/portal/client-access/${invB.body.id}/accept`, {}, auth(userB.token));

  const docA = await insertDocument(lawA.userId, caseIdA, 'سند A');
  const docB = await insertDocument(lawB.userId, caseIdB, 'سند B');
  const docWrongCase = await insertDocument(lawA.userId, caseIdA, 'سند دیگر');

  // 1 Lawyer A cannot share Lawyer B document
  const idorB = await req(
    'POST',
    `/api/cases/${caseIdA}/documents/${docB}/share-client`,
    { clientId: clientIdA },
    auth(lawA.token)
  );
  assert('1 lawyer A cannot share lawyer B document', idorB.status === 404, `status ${idorB.status}`);

  // 2 document from other case on wrong caseId path
  await db('documents').where({ id: docWrongCase }).update({ case_id: caseIdA });
  const docOtherCase = await insertDocument(lawA.userId, caseIdB, 'سند روی B');
  const wrongCaseShare = await req(
    'POST',
    `/api/cases/${caseIdA}/documents/${docOtherCase}/share-client`,
    { clientId: clientIdA },
    auth(lawA.token)
  );
  assert('2 cannot share document belonging to another case', wrongCaseShare.status === 404, `status ${wrongCaseShare.status}`);

  // 3 unrelated client
  const badClient = await req(
    'POST',
    `/api/cases/${caseIdA}/documents/${docA}/share-client`,
    { clientId: clientIdB },
    auth(lawA.token)
  );
  assert('3 cannot share with unrelated client', badClient.status === 404, `status ${badClient.status}`);

  const shareOk = await req(
    'POST',
    `/api/cases/${caseIdA}/documents/${docA}/share-client`,
    { clientId: clientIdA },
    auth(lawA.token)
  );
  assert('share document with case client', shareOk.status === 200 && shareOk.body?.status === 'active', `status ${shareOk.status}`);

  // 9 duplicate share
  const dup = await req(
    'POST',
    `/api/cases/${caseIdA}/documents/${docA}/share-client`,
    { clientId: clientIdA },
    auth(lawA.token)
  );
  assert('9 duplicate share not created', dup.status === 200 && dup.body?.id === shareOk.body?.id, `ids ${dup.body?.id} ${shareOk.body?.id}`);

  // 4 client A cannot see case B
  const crossCase = await req('GET', `/api/portal/cases/${caseIdB}/documents`, null, auth(userA.token));
  assert('4 client A cannot list case B documents', crossCase.status === 404, `status ${crossCase.status}`);

  const listA = await req('GET', `/api/portal/cases/${caseIdA}/documents`, null, auth(userA.token));
  assert('client A sees shared doc only', listA.status === 200 && listA.body?.length === 1 && listA.body[0]?.id === docA, `len ${listA.body?.length}`);

  // 12 private doc not listed
  const privateDoc = await insertDocument(lawA.userId, caseIdA, 'خصوصی');
  const listAfterPrivate = await req('GET', `/api/portal/cases/${caseIdA}/documents`, null, auth(userA.token));
  assert('12 private lawyer doc hidden from portal', listAfterPrivate.body?.length === 1, `len ${listAfterPrivate.body?.length}`);

  // 5 client cannot download private by URL
  const dlPrivate = await req('GET', `/api/portal/cases/${caseIdA}/documents/${privateDoc}/download`, null, auth(userA.token));
  assert('5 private documentId download blocked', dlPrivate.status === 404, `status ${dlPrivate.status}`);

  // 6 wrong caseId in URL
  const dlWrongCase = await req('GET', `/api/portal/cases/${caseIdB}/documents/${docA}/download`, null, auth(userA.token));
  assert('6 wrong caseId download blocked', dlWrongCase.status === 404, `status ${dlWrongCase.status}`);

  // share same doc to another client on same case for test 7
  const clientA2Rec = await req('POST', '/api/clients', {
    name: 'موکل A2',
    phone: '09121110003',
    case_id: caseIdA
  }, auth(lawA.token));
  const clientIdA2 = clientA2Rec.body?.id;
  const userA2 = await createClientUser(`a2.${tag}`, '09121110003');
  await db('clients').where({ id: clientIdA2 }).update({ user_id: userA2.userId });
  const invA2 = await req('POST', `/api/cases/${caseIdA}/client-access/invite`, { clientId: clientIdA2 }, auth(lawA.token));
  await req('POST', `/api/portal/client-access/${invA2.body.id}/accept`, {}, auth(userA2.token));

  // 7 client A2 cannot download doc shared only with A
  const dlOtherClient = await req('GET', `/api/portal/cases/${caseIdA}/documents/${docA}/download`, null, auth(userA2.token));
  assert('7 shared doc for other client blocked', dlOtherClient.status === 404, `status ${dlOtherClient.status}`);

  const dlOk = await req('GET', `/api/portal/cases/${caseIdA}/documents/${docA}/download`, null, auth(userA.token));
  assert('client A download shared doc', dlOk.status === 200 && (dlOk.raw || '').includes('%PDF'), `status ${dlOk.status}`);

  // 8 revoke blocks download
  const rev = await req(
    'DELETE',
    `/api/cases/${caseIdA}/documents/${docA}/share-client/${clientIdA}`,
    null,
    auth(lawA.token)
  );
  assert('revoke share', rev.status === 200 && rev.body?.status === 'revoked', `status ${rev.status}`);
  const dlRevoked = await req('GET', `/api/portal/cases/${caseIdA}/documents/${docA}/download`, null, auth(userA.token));
  assert('8 revoked share not downloadable', dlRevoked.status === 404, `status ${dlRevoked.status}`);

  // 10 re-share reactivates
  const reShare = await req(
    'POST',
    `/api/cases/${caseIdA}/documents/${docA}/share-client`,
    { clientId: clientIdA },
    auth(lawA.token)
  );
  assert('10 re-share activates revoked row', reShare.status === 200 && reShare.body?.status === 'active', `status ${reShare.status}`);
  const dlAgain = await req('GET', `/api/portal/cases/${caseIdA}/documents/${docA}/download`, null, auth(userA.token));
  assert('download works after re-share', dlAgain.status === 200, `status ${dlAgain.status}`);

  // 11 unauthenticated
  const noAuth = await req('GET', `/api/portal/cases/${caseIdA}/documents/${docA}/download`);
  assert('11 unauthenticated download rejected', noAuth.status === 401, `status ${noAuth.status}`);

  // lawyer IDOR share on B case
  const idorCase = await req(
    'POST',
    `/api/cases/${caseIdB}/documents/${docB}/share-client`,
    { clientId: clientIdB },
    auth(lawA.token)
  );
  assert('lawyer A cannot share on lawyer B case', idorCase.status === 404, `status ${idorCase.status}`);

  // lawyer download still works
  const lawDl = await req('GET', `/api/documents/${docA}/download`, null, auth(lawA.token));
  assert('lawyer internal download unchanged', lawDl.status === 200, `status ${lawDl.status}`);

  try {
    const docIds = [docA, docB, docOtherCase, docWrongCase, privateDoc];
    await db('case_client_document_access').whereIn('document_id', docIds).del();
    await db('documents').whereIn('id', docIds).del();
    await db('case_client_access').whereIn('case_id', [caseIdA, caseIdB]).del();
    await db('clients').whereIn('id', [clientIdA, clientIdB, clientIdA2]).del();
    await db('cases').whereIn('id', [caseIdA, caseIdB]).del();
    await db('users').whereIn('id', [lawA.userId, lawB.userId, userA.userId, userB.userId, userA2.userId]).del();
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
