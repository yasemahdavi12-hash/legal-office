/**
 * Client portal access — invite, revoke, IDOR, portal case view.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');

let PORT = 0;
let server;
const results = [];

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
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
          resolve({ status: res.statusCode, body: json });
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
  const email = `lawyer.${tag}@test.local`;
  const password = 'LawyerPass99!';
  const reg = await req('POST', '/api/register', {
    name: 'وکیل ' + tag,
    email,
    password,
    role: 'lawyer'
  });
  return {
    token: reg.body.accessToken || reg.body.token,
    userId: reg.body.user?.id,
    status: reg.status
  };
}

async function createClientUser(tag) {
  const email = `client.${tag}@test.local`;
  const password = 'ClientPass99!';
  const id = await db('users').insert({
    name: 'موکل ' + tag,
    email,
    phone: null,
    password_hash: await bcrypt.hash(password, 12),
    role: 'client',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });
  const userId = Array.isArray(id) ? id[0] : id;
  const login = await req('POST', '/api/login', { email, password });
  return {
    userId,
    token: login.body.accessToken || login.body.token,
    email
  };
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nClient portal access tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const lawyerA = await registerLawyer(`a.${tag}`);
  const lawyerB = await registerLawyer(`b.${tag}`);
  assert('lawyers register', !!lawyerA.token && !!lawyerB.token);

  const caseA = await req('POST', '/api/cases', {
    case_number: `CA-${tag}`,
    title: 'پرونده A'
  }, auth(lawyerA.token));
  const caseB = await req('POST', '/api/cases', {
    case_number: `CB-${tag}`,
    title: 'پرونده B'
  }, auth(lawyerB.token));
  const caseIdA = caseA.body?.id;
  const caseIdB = caseB.body?.id;
  assert('cases created', caseA.status === 201 && caseB.status === 201);

  const clientRec = await req('POST', '/api/clients', {
    name: 'موکل تست',
    phone: '09120000001',
    case_id: caseIdA
  }, auth(lawyerA.token));
  const clientId = clientRec.body?.id;
  assert('client created', clientRec.status === 201 || clientRec.status === 200, `status ${clientRec.status}`);

  const clientUserA = await createClientUser(`a.${tag}`);
  const clientUserB = await createClientUser(`b.${tag}`);
  await db('clients').where({ id: clientId }).update({ user_id: clientUserA.userId });

  // 1) lawyer invites own client
  const inv = await req(
    'POST',
    `/api/cases/${caseIdA}/client-access/invite`,
    { clientId },
    auth(lawyerA.token)
  );
  assert('1 lawyer invite own client', inv.status === 201 && inv.body?.status === 'pending', `status ${inv.status}`);
  const accessId = inv.body?.id;

  // 2) invite other lawyer case → reject
  const wrongCase = await req(
    'POST',
    `/api/cases/${caseIdB}/client-access/invite`,
    { clientId },
    auth(lawyerA.token)
  );
  assert('2 invite on other lawyer case → reject', wrongCase.status === 404, `status ${wrongCase.status}`);

  // 3) invalid client
  const badClient = await req(
    'POST',
    `/api/cases/${caseIdA}/client-access/invite`,
    { clientId: 99999999 },
    auth(lawyerA.token)
  );
  assert('3 invalid client → reject', badClient.status === 404, `status ${badClient.status}`);

  // duplicate active after accept
  await req('POST', `/api/portal/client-access/${accessId}/accept`, {}, auth(clientUserA.token));
  const dupActive = await req(
    'POST',
    `/api/cases/${caseIdA}/client-access/invite`,
    { clientId },
    auth(lawyerA.token)
  );
  assert('4 duplicate active → reject', dupActive.status === 409, `status ${dupActive.status}`);

  // 8) active client sees case
  const portalCase = await req('GET', `/api/portal/cases/${caseIdA}`, null, auth(clientUserA.token));
  assert('8 active client sees case', portalCase.status === 200 && portalCase.body?.id === caseIdA, `status ${portalCase.status}`);

  // 7) pending cannot see (new invite on lawyer B client link)
  const clientBRec = await req('POST', '/api/clients', {
    name: 'موکل B',
    case_id: caseIdB
  }, auth(lawyerB.token));
  const clientIdB = clientBRec.body?.id;
  await db('clients').where({ id: clientIdB }).update({ user_id: clientUserB.userId });
  const invPending = await req(
    'POST',
    `/api/cases/${caseIdB}/client-access/invite`,
    { clientId: clientIdB },
    auth(lawyerB.token)
  );
  const pendingId = invPending.body?.id;
  const pendingView = await req('GET', `/api/portal/cases/${caseIdB}`, null, auth(clientUserB.token));
  assert('7 pending cannot see case', pendingView.status === 404, `status ${pendingView.status}`);

  // 6) client A cannot see case B
  const crossCase = await req('GET', `/api/portal/cases/${caseIdB}`, null, auth(clientUserA.token));
  assert('6 client A cannot see case B', crossCase.status === 404, `status ${crossCase.status}`);

  // 9) client A cannot see B's access list (lawyer list IDOR on case)
  const listB = await req('GET', `/api/cases/${caseIdB}/client-access`, null, auth(lawyerA.token));
  assert('9 lawyer A cannot list case B access', listB.status === 404, `status ${listB.status}`);

  // 11) client cannot revoke (lawyer-only) — client gets 404 on case
  const clientRevoke = await req(
    'DELETE',
    `/api/cases/${caseIdA}/client-access/${accessId}`,
    null,
    auth(clientUserA.token)
  );
  assert('11 client cannot revoke access', clientRevoke.status === 404, `status ${clientRevoke.status}`);

  // revoke soft
  const revoke = await req(
    'DELETE',
    `/api/cases/${caseIdA}/client-access/${accessId}`,
    null,
    auth(lawyerA.token)
  );
  assert('5 revoke → status revoked', revoke.status === 200 && revoke.body?.status === 'revoked', `status ${revoke.status}`);

  const afterRevoke = await req('GET', `/api/portal/cases/${caseIdA}`, null, auth(clientUserA.token));
  assert('6b revoked cannot see case', afterRevoke.status === 404, `status ${afterRevoke.status}`);

  // re-invite revoked → pending
  const reinv = await req(
    'POST',
    `/api/cases/${caseIdA}/client-access/invite`,
    { clientId },
    auth(lawyerA.token)
  );
  assert('revoked re-invite → pending', reinv.status === 201 && reinv.body?.status === 'pending', `status ${reinv.status}`);

  // 7) no auth
  const noAuth = await req('GET', `/api/portal/cases/${caseIdA}`);
  assert('7 unauthenticated → 401', noAuth.status === 401, `status ${noAuth.status}`);

  // accept pending for B
  await req('POST', `/api/portal/client-access/${pendingId}/accept`, {}, auth(clientUserB.token));

  // 10) client A cannot accept B's invite
  const crossAccept = await req(
    'POST',
    `/api/portal/client-access/${pendingId}/accept`,
    {},
    auth(clientUserA.token)
  );
  assert('10 client A cannot accept B invite', crossAccept.status === 404, `status ${crossAccept.status}`);

  // auth regression: lawyer still gets cases
  const casesLawyer = await req('GET', '/api/cases', null, auth(lawyerA.token));
  assert('auth regression lawyer cases', casesLawyer.status === 200 && Array.isArray(casesLawyer.body), `status ${casesLawyer.status}`);

  // cleanup
  try {
    const uids = [lawyerA.userId, lawyerB.userId, clientUserA.userId, clientUserB.userId].filter(Boolean);
    await db('case_client_access').whereIn('case_id', [caseIdA, caseIdB]).del();
    await db('clients').whereIn('owner_id', uids).del();
    await db('cases').whereIn('id', [caseIdA, caseIdB]).del();
    await db('refresh_tokens').whereIn('user_id', uids).del();
    await db('users').whereIn('id', uids).del();
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
