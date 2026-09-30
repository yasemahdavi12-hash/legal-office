/**
 * Client portal auth — register/login/accept/phone claim/IDOR.
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
const PHONE = '09121234567';

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

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nClient portal auth tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;

  const lawyerReg = await req('POST', '/api/register', {
    name: 'وکیل',
    email: `law.auth.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'lawyer'
  });
  const lawyerToken = lawyerReg.body.accessToken || lawyerReg.body.token;
  assert('lawyer register', !!lawyerToken);

  const caseRes = await req('POST', '/api/cases', {
    case_number: `AUTH-${tag}`,
    title: 'پرونده auth'
  }, auth(lawyerToken));
  const caseId = caseRes.body?.id;

  const clientRes = await req('POST', '/api/clients', {
    name: 'موکل دعوت',
    phone: PHONE,
    case_id: caseId
  }, auth(lawyerToken));
  const clientId = clientRes.body?.id;
  assert('client CRM created', !!clientId);

  const invite = await req(
    'POST',
    `/api/cases/${caseId}/client-access/invite`,
    { clientId },
    auth(lawyerToken)
  );
  const accessId = invite.body?.id;
  assert('invite pending', invite.status === 201 && invite.body?.status === 'pending');

  const reg = await req('POST', '/api/portal/register', {
    name: 'موکل پورتال',
    email: `client.auth.${tag}@test.local`,
    password: 'ClientPass99!',
    phone: PHONE,
    role: 'lawyer'
  });
  assert('portal register → client role', reg.status === 201 && reg.body?.user?.role === 'client', `role=${reg.body?.user?.role}`);
  const clientToken = reg.body.accessToken || reg.body.token;

  const lawyerPortalLogin = await req('POST', '/api/portal/login', {
    email: `law.auth.${tag}@test.local`,
    password: 'LawyerPass99!'
  });
  assert('lawyer cannot portal login', lawyerPortalLogin.status === 403, `status ${lawyerPortalLogin.status}`);

  const pending = await req('GET', '/api/portal/client-access/pending', null, auth(clientToken));
  assert(
    'pending list includes phone-matched invite',
    pending.status === 200 && Array.isArray(pending.body) && pending.body.some((p) => p.id === accessId),
    `count ${pending.body?.length}`
  );

  const accept = await req('POST', `/api/portal/client-access/${accessId}/accept`, {}, auth(clientToken));
  assert('accept → active', accept.status === 200 && accept.body?.status === 'active', `status ${accept.status}`);

  const linked = await db('clients').where({ id: clientId }).first();
  assert('clients.user_id linked', linked && linked.user_id === reg.body.user.id);

  const dupAccept = await req('POST', `/api/portal/client-access/${accessId}/accept`, {}, auth(clientToken));
  assert('duplicate accept idempotent', dupAccept.status === 200 && dupAccept.body?.status === 'active');

  const cases = await req('GET', '/api/portal/cases', null, auth(clientToken));
  assert('list portal cases', cases.status === 200 && cases.body.some((c) => c.id === caseId));

  const getCase = await req('GET', `/api/portal/cases/${caseId}`, null, auth(clientToken));
  assert('get portal case', getCase.status === 200 && getCase.body?.title, `status ${getCase.status}`);

  const wrongCase = await req('GET', `/api/portal/cases/99999999`, null, auth(clientToken));
  assert('wrong caseId → 404', wrongCase.status === 404);

  const otherReg = await req('POST', '/api/portal/register', {
    name: 'موکل B',
    email: `client.b.${tag}@test.local`,
    password: 'ClientPass99!',
    phone: '09129876543'
  });
  const otherToken = otherReg.body.accessToken || otherReg.body.token;
  const crossAccept = await req('POST', `/api/portal/client-access/${accessId}/accept`, {}, auth(otherToken));
  assert('client B cannot accept A invite', crossAccept.status === 404, `status ${crossAccept.status}`);

  const caseB = await req('POST', '/api/cases', {
    case_number: `B-${tag}`,
    title: 'B'
  }, auth(lawyerToken));
  const clientB = await req('POST', '/api/clients', {
    name: 'موکل B2',
    phone: '09129876543',
    case_id: caseB.body.id
  }, auth(lawyerToken));
  const invB = await req('POST', `/api/cases/${caseB.body.id}/client-access/invite`, { clientId: clientB.body.id }, auth(lawyerToken));
  const crossCase = await req('GET', `/api/portal/cases/${caseB.body.id}`, null, auth(clientToken));
  assert('client A cannot view case B', crossCase.status === 404);

  const login = await req('POST', '/api/portal/login', {
    email: `client.auth.${tag}@test.local`,
    password: 'ClientPass99!'
  });
  assert('portal login client', login.status === 200 && login.body?.user?.role === 'client');

  const tag2 = tag + '.claim';
  const case2 = await req('POST', '/api/cases', { case_number: `C2-${tag2}`, title: 'race' }, auth(lawyerToken));
  const crm2 = await req('POST', '/api/clients', { name: 'Race', phone: '09121112233', case_id: case2.body.id }, auth(lawyerToken));
  const inv2 = await req('POST', `/api/cases/${case2.body.id}/client-access/invite`, { clientId: crm2.body.id }, auth(lawyerToken));
  const u1 = await req('POST', '/api/portal/register', {
    name: 'R1', email: `r1.${tag2}@test.local`, password: 'ClientPass99!', phone: '09121112233'
  });
  const u2 = await req('POST', '/api/portal/register', {
    name: 'R2', email: `r2.${tag2}@test.local`, password: 'ClientPass99!', phone: '09121112233'
  });
  const [a1, a2] = await Promise.all([
    req('POST', `/api/portal/client-access/${inv2.body.id}/accept`, {}, auth(u1.body.accessToken)),
    req('POST', `/api/portal/client-access/${inv2.body.id}/accept`, {}, auth(u2.body.accessToken))
  ]);
  const okCount = [a1, a2].filter((r) => r.status === 200).length;
  const failCount = [a1, a2].filter((r) => r.status === 404 || r.status === 409).length;
  assert('race: one success one fail', okCount === 1 && failCount === 1, `ok=${okCount} fail=${failCount}`);

  try {
    const uids = [reg.body.user.id, otherReg.body.user.id, u1.body.user.id, u2.body.user.id, lawyerReg.body.user.id].filter(Boolean);
    await db('case_client_access').whereIn('case_id', [caseId, caseB.body?.id, case2.body?.id].filter(Boolean)).del();
    await db('clients').whereIn('owner_id', uids).del();
    await db('cases').whereIn('owner_id', uids).del();
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
